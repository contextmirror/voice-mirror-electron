<script>
  /**
   * UsagePulse.svelte -- native "usage pulse" strip for the status bar.
   *
   * Renders Claude Code usage (model, session/weekly limits, context, cost, and
   * the peak-hours window) from `aiStatusStore.usage`, which the backend usage
   * watcher populates from Claude Code's status-line JSON. This is the native,
   * dependency-free equivalent of claude-pulse's terminal bar.
   */
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { configStore } from '../../lib/stores/config.svelte.js';
  import { detectCurrency, getUsdConversion, formatCost } from '../../lib/currency.js';

  // Anthropic's peak-consumption window (local time, weekdays). Matches the
  // claude-pulse default; hard-coded for v1 (could become configurable later).
  const PEAK_START = 13; // 1pm
  const PEAK_END = 19; // 7pm

  const usage = $derived(aiStatusStore.usage);
  // Only surface for a running CLI (Claude Code) session with a snapshot.
  const show = $derived(!!usage && aiStatusStore.isCliProvider);

  // Tick every 60s so the peak indicator / reset labels stay fresh without a
  // dependency on external state.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowMs = Date.now(); }, 60_000);
    return () => clearInterval(id);
  });

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Format a Unix-epoch-seconds reset time as e.g. "Sat 4am". */
  function formatReset(epochSec) {
    if (!epochSec) return '';
    const d = new Date(epochSec * 1000);
    let h = d.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12;
    if (h === 0) h = 12;
    return `${DAYS[d.getDay()]} ${h}${ampm}`;
  }

  /** Colour band for a usage percentage (higher = worse). */
  function level(pct) {
    if (pct == null) return '';
    if (pct >= 85) return 'lvl-danger';
    if (pct >= 60) return 'lvl-warn';
    return 'lvl-ok';
  }

  function pctText(pct) {
    return pct == null ? '' : `${Math.round(pct)}%`;
  }

  // Peak-window state, recomputed on each tick.
  const peak = $derived.by(() => {
    void nowMs; // reactive dependency
    const d = new Date();
    const day = d.getDay();
    const isWeekday = day >= 1 && day <= 5;
    const h = d.getHours() + d.getMinutes() / 60;
    if (isWeekday && h >= PEAK_START && h < PEAK_END) {
      return { state: 'in', label: 'In Peak', icon: '⚡' };
    }
    if (isWeekday && h >= PEAK_START - 1 && h < PEAK_START) {
      return { state: 'soon', label: 'Peak soon', icon: '⚡' };
    }
    return { state: 'off', label: 'Off-Peak', icon: '✓' };
  });

  // Cost is reported by Claude Code in USD. Convert to the user's currency
  // (config override → locale guess) via a cached live rate, so it lines up with
  // e.g. a claude-pulse terminal bar. Falls back to USD if conversion fails.
  let fx = $state({ rate: 1, code: 'USD' });
  $effect(() => {
    const target = configStore.value?.ai?.usageCurrency || detectCurrency();
    let cancelled = false;
    getUsdConversion(target).then((res) => {
      if (!cancelled) fx = res;
    });
    return () => { cancelled = true; };
  });

  const costText = $derived(
    usage?.costUsd != null ? formatCost(usage.costUsd, fx.rate, fx.code) : ''
  );
</script>

{#if show}
  <div class="usage-pulse" aria-label="Claude usage">
    {#if usage.model}
      <span class="up-item up-model" title="Active model">{usage.model}</span>
    {/if}

    {#if usage.hasRateLimits}
      {#if usage.fiveHour}
        <span class="up-item" title="5-hour session limit — resets {formatReset(usage.fiveHour.resetsAt)}">
          <span class="up-label">Session</span>
          <span class="up-bar {level(usage.fiveHour.usedPct)}">
            <span class="up-fill" style="width: {Math.min(100, usage.fiveHour.usedPct)}%"></span>
          </span>
          <span class="up-pct">{pctText(usage.fiveHour.usedPct)}</span>
        </span>
      {/if}

      {#if usage.sevenDay}
        <span class="up-item" title="7-day weekly limit — resets {formatReset(usage.sevenDay.resetsAt)}">
          <span class="up-label">Weekly</span>
          <span class="up-bar {level(usage.sevenDay.usedPct)}">
            <span class="up-fill" style="width: {Math.min(100, usage.sevenDay.usedPct)}%"></span>
          </span>
          <span class="up-pct">{pctText(usage.sevenDay.usedPct)}</span>
          {#if usage.sevenDay.resetsAt}
            <span class="up-reset">R:{formatReset(usage.sevenDay.resetsAt)}</span>
          {/if}
        </span>
      {/if}

      {#if usage.sevenDaySonnet}
        <span class="up-item up-model-limit" title="Weekly Sonnet limit">
          <span class="up-label">Sonnet</span>
          <span class="up-pct {level(usage.sevenDaySonnet.usedPct)}">{pctText(usage.sevenDaySonnet.usedPct)}</span>
        </span>
      {/if}
    {/if}

    {#if usage.contextPct != null}
      <span class="up-item" title="Context window usage">
        <span class="up-label">Context</span>
        <span class="up-bar {level(usage.contextPct)}">
          <span class="up-fill" style="width: {Math.min(100, usage.contextPct)}%"></span>
        </span>
        <span class="up-pct">{pctText(usage.contextPct)}</span>
      </span>
    {/if}

    {#if costText}
      <span class="up-item up-cost"
        title="Session cost at API-equivalent rates ({fx.code}{fx.code !== 'USD' ? `, converted from USD ×${fx.rate.toFixed(3)}` : ''}). On a subscription this is notional — your real out-of-pocket is $0.">{costText}</span>
    {/if}

    <span class="up-item up-peak up-peak-{peak.state}"
      title="Anthropic peak window {PEAK_START}:00–{PEAK_END}:00 on weekdays (limits burn ~2× faster)">
      {peak.label} {peak.icon}
    </span>
  </div>
{/if}

<style>
  .usage-pulse {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 12px;
    color: var(--muted);
  }

  .up-item {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 100%;
  }

  .up-label {
    color: var(--muted);
  }

  .up-model {
    color: var(--text-strong, var(--text));
    font-weight: 600;
  }

  /* Progress bars — thin track + fill, coloured by usage band. */
  .up-bar {
    position: relative;
    width: 30px;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-hover, rgba(255, 255, 255, 0.1));
    overflow: hidden;
    flex-shrink: 0;
  }

  .up-fill {
    position: absolute;
    inset: 0 auto 0 0;
    height: 100%;
    border-radius: 2px;
    background: var(--muted);
    transition: width var(--duration-fast, 120ms) ease-out;
  }

  .up-bar.lvl-ok .up-fill { background: var(--ok, #22c55e); }
  .up-bar.lvl-warn .up-fill { background: var(--warn, #f59e0b); }
  .up-bar.lvl-danger .up-fill { background: var(--danger, #ef4444); }

  .up-pct {
    color: var(--text, var(--muted));
    font-variant-numeric: tabular-nums;
  }

  .up-pct.lvl-ok { color: var(--ok, #22c55e); }
  .up-pct.lvl-warn { color: var(--warn, #f59e0b); }
  .up-pct.lvl-danger { color: var(--danger, #ef4444); }

  .up-reset,
  .up-model-limit .up-label {
    color: var(--muted);
    opacity: 0.85;
  }

  .up-cost {
    color: var(--text, var(--muted));
    font-variant-numeric: tabular-nums;
  }

  .up-peak-off { color: var(--ok, #22c55e); }
  .up-peak-soon { color: var(--warn, #f59e0b); }
  .up-peak-in { color: var(--danger, #ef4444); }

  /* Hide the widest, least-critical items first on narrow windows so the
     strip degrades gracefully instead of forcing the bar to overflow. */
  @media (max-width: 1100px) {
    .up-reset,
    .up-model-limit,
    .up-cost { display: none; }
  }
  @media (max-width: 900px) {
    .up-peak,
    .up-model { display: none; }
  }
</style>
