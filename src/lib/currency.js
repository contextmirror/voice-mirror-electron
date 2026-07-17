/**
 * currency.js -- USD → local-currency conversion for the usage cost display.
 *
 * Claude Code reports session cost in USD. Users think in their own currency,
 * so we convert using a live exchange rate (frankfurter.dev — free, no auth,
 * read-only) cached in localStorage for 24h. Mirrors what claude-pulse does in
 * its Python, but from the webview (CSP allows https: connect-src).
 *
 * NOTE: the old api.frankfurter.app host now 301-redirects to api.frankfurter.dev,
 * and a cross-origin redirect drops CORS — so we must hit the .dev host directly.
 *
 * All functions are defensive: a failed fetch or unknown currency falls back to
 * showing plain USD rather than a wrong symbol on an unconverted amount.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Common region → ISO-4217 currency, enough to auto-pick for most users. */
const REGION_CURRENCY = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR',
  JP: 'JPY', CN: 'CNY', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', BR: 'BRL', ZA: 'ZAR', MX: 'MXN', SG: 'SGD', HK: 'HKD',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
  PT: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR',
};

/**
 * Best-guess display currency from the browser locale (e.g. en-GB → GBP).
 * Defaults to USD when the region is unknown.
 */
export function detectCurrency() {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return REGION_CURRENCY[region] || 'USD';
  } catch {
    return 'USD';
  }
}

/** The currency symbol for an ISO code (e.g. GBP → £), via Intl. */
export function currencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || code;
  } catch {
    return code || '$';
  }
}

/**
 * Resolve a USD→target conversion, cached 24h in localStorage.
 *
 * Returns `{ rate, code }` where `code` is the currency actually applied — the
 * target on success, or 'USD' (rate 1) if conversion isn't possible, so callers
 * never render a foreign symbol against an unconverted amount.
 *
 * @param {string} target - ISO-4217 code (e.g. 'GBP'). 'USD' is a no-op.
 * @returns {Promise<{rate: number, code: string}>}
 */
export async function getUsdConversion(target) {
  if (!target || target === 'USD') return { rate: 1, code: 'USD' };

  const key = `vm-fx-USD-${target}`;
  const cached = readCache(key);
  if (cached && Date.now() - cached.ts < DAY_MS && cached.rate > 0) {
    return { rate: cached.rate, code: target };
  }

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=USD&to=${encodeURIComponent(target)}`);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.[target];
      if (typeof rate === 'number' && rate > 0) {
        writeCache(key, { rate, ts: Date.now() });
        return { rate, code: target };
      }
    }
  } catch {
    // Offline / blocked — fall through to stale cache or USD.
  }

  // Prefer a stale cached rate over showing the wrong number.
  if (cached && cached.rate > 0) return { rate: cached.rate, code: target };
  // Last resort: show honest USD.
  return { rate: 1, code: 'USD' };
}

/** Format a USD amount into a target currency string, e.g. "£0.09". */
export function formatCost(costUsd, rate, code) {
  const symbol = currencySymbol(code);
  return `${symbol}${(costUsd * rate).toFixed(2)}`;
}

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable — non-fatal, we just re-fetch next time.
  }
}
