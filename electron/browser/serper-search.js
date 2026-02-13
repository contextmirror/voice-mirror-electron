/**
 * Serper.dev API integration for Voice Mirror.
 *
 * Fast, reliable Google search results via API.
 * Free tier: 2,500 queries/month, no credit card required.
 */

const https = require('https');
const { formatResults } = require('./search-utils');
const { createLogger } = require('../services/logger');
const logger = createLogger();

/**
 * Search using Serper.dev API.
 *
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @param {string} args.apiKey - Serper.dev API key
 * @param {number} [args.max_results=5] - Maximum results to return
 * @param {number} [args.timeout=10000] - Timeout in milliseconds
 * @returns {Promise<Object>} Search results
 */
async function searchSerper(args = {}) {
    const {
        query,
        apiKey,
        max_results = 5,
        timeout = 10000,
    } = args;

    if (!query) {
        return {
            ok: false,
            error: 'Search query is required',
        };
    }

    if (!apiKey) {
        return {
            ok: false,
            error: 'Serper API key is required',
        };
    }

    const maxResults = Math.min(Math.max(1, max_results), 10);

    try {
        logger.info('[Serper]', `Searching: "${query}"`);

        const response = await makeRequest({
            query,
            apiKey,
            num: maxResults,
            timeout,
        });

        if (!response.organic || response.organic.length === 0) {
            logger.info('[Serper]', 'No organic results');
            return {
                ok: true,
                action: 'search',
                result: `No results found for "${query}".`,
                results: [],
            };
        }

        const results = response.organic.slice(0, maxResults).map(item => ({
            title: item.title || '',
            snippet: item.snippet || '',
            url: item.link || '',
        }));

        logger.info('[Serper]', `Found ${results.length} results`);
        return formatResults(query, results);

    } catch (err) {
        logger.error('[Serper]', 'Error:', err.message);
        return {
            ok: false,
            error: `Search failed: ${err.message}`,
        };
    }
}

/**
 * Make HTTPS request to Serper API.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
function makeRequest({ query, apiKey, num, timeout }) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            q: query,
            num: num,
        });

        const options = {
            hostname: 'google.serper.dev',
            port: 443,
            path: '/search',
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: timeout,
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Invalid API key'));
                } else if (res.statusCode === 429) {
                    reject(new Error('Rate limit exceeded'));
                } else {
                    reject(new Error(`API error: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

module.exports = {
    searchSerper,
};
