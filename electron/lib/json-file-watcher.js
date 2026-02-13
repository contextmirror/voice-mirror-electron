/**
 * Factory for creating JSON file watchers with fs.watch + polling fallback.
 *
 * Common pattern used by inbox-watcher, browser-watcher, and screen-capture-watcher:
 * watch a directory for a specific file change, debounce, then call a handler.
 */

const fs = require('fs');
const { createLogger } = require('../services/logger');
const logger = createLogger();

/**
 * Create a JSON file watcher.
 * @param {Object} options
 * @param {string} options.watchDir - Directory to watch
 * @param {string} options.filename - Filename to react to (e.g. 'inbox.json')
 * @param {number} [options.debounceMs=0] - Debounce interval (0 = no debounce)
 * @param {Function} options.onEvent - Called when the watched file changes
 * @param {string} [options.label='FileWatcher'] - Label for log messages
 * @returns {{ start(): void, stop(): void, isRunning(): boolean }}
 */
function createJsonFileWatcher(options) {
    const {
        watchDir,
        filename,
        debounceMs = 0,
        onEvent,
        label = 'FileWatcher'
    } = options;

    let watcher = null;
    let debounceTimer = null;

    function trigger() {
        if (debounceMs > 0) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => onEvent(), debounceMs);
        } else {
            onEvent();
        }
    }

    function start() {
        if (watcher) {
            logger.info(`[${label}]`, 'Already running');
            return;
        }

        try {
            const fsWatcher = fs.watch(watchDir, (_eventType, changedFile) => {
                if (changedFile === filename) {
                    trigger();
                }
            });
            fsWatcher.on('error', (err) => {
                logger.error(`[${label}]`, 'fs.watch error, falling back to polling:', err.message);
                // Replace with polling fallback
                watcher = {
                    _polling: setInterval(() => onEvent(), 2000),
                    _close() {
                        clearInterval(this._polling);
                        if (debounceTimer) clearTimeout(debounceTimer);
                    }
                };
            });

            watcher = {
                _fsWatcher: fsWatcher,
                _close() {
                    try { fsWatcher.close(); } catch {}
                    if (debounceTimer) clearTimeout(debounceTimer);
                }
            };
        } catch (err) {
            logger.error(`[${label}]`, 'fs.watch unavailable, using polling fallback:', err.message);
            watcher = {
                _polling: setInterval(() => onEvent(), 2000),
                _close() {
                    clearInterval(this._polling);
                    if (debounceTimer) clearTimeout(debounceTimer);
                }
            };
        }

        logger.info(`[${label}]`, 'Watcher started');
    }

    function stop() {
        if (watcher) {
            watcher._close();
            watcher = null;
            logger.info(`[${label}]`, 'Watcher stopped');
        }
    }

    function isRunning() {
        return watcher !== null;
    }

    return { start, stop, isRunning };
}

module.exports = { createJsonFileWatcher };
