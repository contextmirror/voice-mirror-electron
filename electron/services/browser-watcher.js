/**
 * Browser request watcher service for Voice Mirror Electron.
 * Watches for browser requests from Claude via MCP (browser_search, browser_fetch).
 */

const fs = require('fs');
const path = require('path');

/**
 * Create a browser watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {string} options.serperApiKey - Serper.dev API key for web search
 * @returns {Object} Browser watcher service instance
 */
function createBrowserWatcher(options = {}) {
    const { dataDir, serperApiKey } = options;

    let watcher = null;
    let browserModule = null;

    /**
     * Lazy-load the browser module.
     * This avoids loading Playwright until actually needed.
     */
    function getBrowserModule() {
        if (!browserModule) {
            browserModule = require('../browser');
            // Configure Serper API key for web search
            if (serperApiKey) {
                browserModule.setSerperApiKey(serperApiKey);
            }
        }
        return browserModule;
    }

    /**
     * Start watching for browser requests.
     */
    function start() {
        if (watcher) {
            console.log('[BrowserWatcher] Already running');
            return;
        }

        const contextMirrorDir = dataDir || path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'voice-mirror-electron', 'data');
        const requestPath = path.join(contextMirrorDir, 'browser_request.json');
        const responsePath = path.join(contextMirrorDir, 'browser_response.json');

        // Watch for browser requests
        watcher = setInterval(async () => {
            try {
                if (!fs.existsSync(requestPath)) return;

                const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
                const requestTime = new Date(request.timestamp).getTime();
                const now = Date.now();

                // Only process requests from the last 5 seconds
                if (now - requestTime > 5000) {
                    fs.unlinkSync(requestPath);
                    return;
                }

                // Delete request immediately to prevent duplicate processing
                fs.unlinkSync(requestPath);

                console.log(`[BrowserWatcher] Request: ${request.action}`);

                let result;
                const browser = getBrowserModule();

                switch (request.action) {
                    case 'search':
                        result = await browser.webSearch(request.args);
                        break;
                    case 'fetch':
                        result = await browser.fetchUrl(request.args);
                        break;
                    default:
                        result = { success: false, error: `Unknown browser action: ${request.action}` };
                }

                // Write response
                fs.writeFileSync(responsePath, JSON.stringify({
                    ...result,
                    request_id: request.id,
                    timestamp: new Date().toISOString()
                }, null, 2));

                console.log(`[BrowserWatcher] Response written for ${request.action}`);

            } catch (err) {
                console.error('[BrowserWatcher] Error:', err);
            }
        }, 500);  // Check every 500ms

        console.log('[BrowserWatcher] Started');
    }

    /**
     * Stop watching for browser requests.
     */
    function stop() {
        if (watcher) {
            clearInterval(watcher);
            watcher = null;
            console.log('[BrowserWatcher] Stopped');
        }
    }

    /**
     * Close the browser instance (for cleanup).
     */
    async function closeBrowser() {
        if (browserModule) {
            try {
                await browserModule.closeBrowser();
                console.log('[BrowserWatcher] Browser closed');
            } catch (err) {
                console.error('[BrowserWatcher] Error closing browser:', err.message);
            }
        }
    }

    /**
     * Check if watcher is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return watcher !== null;
    }

    return {
        start,
        stop,
        closeBrowser,
        isRunning
    };
}

module.exports = {
    createBrowserWatcher
};
