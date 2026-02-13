/**
 * Shared utilities for search modules.
 */

/**
 * Format search results into a standardised response object.
 *
 * @param {string} query - The original search query
 * @param {Array<{title: string, snippet?: string, url: string}>} results
 * @param {string} [engine='Web'] - Display name of the search engine
 * @returns {{ok: boolean, action: string, result: string, results: Array}}
 */
function formatResults(query, results, engine = 'Search') {
    const formatted = results.map((r, i) => {
        let entry = `${i + 1}. ${r.title}`;
        if (r.snippet) entry += `\n   ${r.snippet}`;
        entry += `\n   URL: ${r.url}`;
        return entry;
    }).join('\n\n');

    return {
        ok: true,
        action: 'search',
        result: `${engine} results for "${query}":\n\n${formatted}`,
        results: results.map(r => ({
            title: r.title,
            snippet: r.snippet,
            url: r.url,
        })),
    };
}

module.exports = { formatResults };
