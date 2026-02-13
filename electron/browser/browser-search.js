/**
 * Web search implementation for Voice Mirror.
 *
 * Priority order:
 * 1. Serper.dev API (fast, reliable, if API key configured)
 * 2. Webview fallback (navigate embedded browser to search engine)
 */

const cdp = require('./webview-cdp');
const { searchSerper } = require('./serper-search');
const { formatResults } = require('./search-utils');
const { createLogger } = require('../services/logger');
const logger = createLogger();

// Serper API key
let serperApiKey = process.env.SERPER_API_KEY || '';

/**
 * Set the Serper API key.
 * @param {string} apiKey
 */
function setSerperApiKey(apiKey) {
    serperApiKey = apiKey;
    if (apiKey) {
        logger.info('[Browser Search]', 'Serper API key configured');
    }
}

/**
 * Search the web.
 *
 * Uses Serper.dev API if configured, otherwise falls back to webview scraping.
 *
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @param {number} [args.max_results=5] - Maximum results to return
 * @param {number} [args.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Search results
 */
async function webSearch(args = {}) {
    const { query, max_results = 5, timeout = 30000 } = args;

    if (!query) {
        return { ok: false, error: 'Search query is required' };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    // Try Serper API first
    if (serperApiKey) {
        logger.info('[Browser Search]', 'Using Serper API...');
        const serperResult = await searchSerper({
            query,
            apiKey: serperApiKey,
            max_results: maxResults,
            timeout: Math.min(timeout, 10000),
        });

        if (serperResult.ok) {
            return serperResult;
        }

        logger.info('[Browser Search]', 'Serper failed:', serperResult.error);
        logger.info('[Browser Search]', 'Falling back to webview...');
    }

    // Fallback: navigate webview to Google and scrape results
    return await browserSearch(args);
}

/**
 * Webview-based search fallback.
 * Navigates the embedded webview to Google and extracts results via CDP.
 */
async function browserSearch(args = {}) {
    const { query, max_results = 5 } = args;

    if (!cdp.isAttached()) {
        return { ok: false, error: 'Browser not available. Open the Voice Mirror panel.' };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
        await cdp.navigate(searchUrl);
        await new Promise(r => setTimeout(r, 2500));

        // Extract results via Runtime.evaluate
        const { result } = await cdp.evaluate(`
            (function() {
                const items = [];
                const h3Elements = document.querySelectorAll('h3');
                for (const h3 of h3Elements) {
                    if (items.length >= ${maxResults}) break;
                    const link = h3.closest('a');
                    if (!link || !link.href) continue;
                    const url = link.href;
                    if (url.includes('google.com/search') || url.includes('accounts.google')) continue;
                    const title = h3.textContent?.trim() || '';
                    if (!title) continue;
                    let snippet = '';
                    const container = h3.closest('div[data-hveid]') || h3.closest('div.g');
                    if (container) {
                        const spans = container.querySelectorAll('span, div, em');
                        for (const el of spans) {
                            const text = el.textContent?.trim() || '';
                            if (text.length > 40 && text.length < 400 && text !== title && !text.startsWith('http')) {
                                snippet = text;
                                break;
                            }
                        }
                    }
                    items.push({ title, url, snippet });
                }
                return items;
            })()
        `);

        const results = result?.value || [];
        if (results.length === 0) {
            return { ok: false, error: `No results from Google for "${query}"` };
        }

        logger.info('[Browser Search]', `Google: Found ${results.length} results`);
        return formatResults(query, results, 'Google');
    } catch (err) {
        logger.error('[Browser Search]', 'Webview error:', err.message);
        return { ok: false, error: `Search failed: ${err.message}` };
    }
}

module.exports = {
    webSearch,
    browserSearch,
    setSerperApiKey,
};
