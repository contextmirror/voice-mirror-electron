/**
 * Web search tool handler.
 *
 * Uses Tavily API - optimized for AI agents.
 * Free tier: 1,000 queries/month
 * https://tavily.com/
 */

// Configuration
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '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';

/**
 * Search the web using Tavily API.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.query - Search query
 * @param {number} args.max_results - Maximum results (default: 5)
 * @returns {Promise<Object>} Search results or error
 */
async function webSearch(args = {}) {
    const { query, max_results = 5 } = args;

    if (!query) {
        return {
            success: false,
            error: 'Search query is required'
        };
    }

    try {
        const result = await searchTavily(query, max_results);
        return result;
    } catch (err) {
        console.error('[WebSearch] Tavily failed:', err.message);
        return {
            success: false,
            error: `Search failed: ${err.message}`
        };
    }
}

/**
 * Search via Tavily API.
 * Free tier: 1,000 queries/month, no card required.
 * Optimized for AI agents - returns clean, relevant results.
 * https://tavily.com/
 */
async function searchTavily(query, maxResults) {
    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: query,
            max_results: maxResults,
            search_depth: 'advanced',
            include_answer: true,
            include_raw_content: false
        }),
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tavily API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const results = data.results || [];

    if (results.length === 0 && !data.answer) {
        return {
            success: true,
            result: `No results found for "${query}".`,
            results: []
        };
    }

    // Format results - Tavily can also provide a direct answer
    let formatted = '';
    if (data.answer) {
        formatted = `Answer: ${data.answer}\n\nSources:\n`;
    }

    formatted += results.map((r, i) => {
        return `${i + 1}. ${r.title}\n   ${r.content || ''}\n   URL: ${r.url}`;
    }).join('\n\n');

    return {
        success: true,
        result: `Search results for "${query}":\n\n${formatted}`,
        answer: data.answer || null,
        results: results.map(r => ({
            title: r.title,
            snippet: r.content || '',
            url: r.url
        }))
    };
}

module.exports = { webSearch };
