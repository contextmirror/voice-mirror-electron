/**
 * Shared uiohook-napi singleton.
 *
 * Both push-to-talk and hotkey-manager need uiohook, but calling
 * uIOhook.start() twice crashes. This module ensures a single instance.
 */

let uIOhook = null;
let UiohookKey = null;
let started = false;
let loadError = null;

// Try to load uiohook-napi once
try {
    const mod = require('uiohook-napi');
    uIOhook = mod.uIOhook;
    UiohookKey = mod.UiohookKey;
    console.log('[uiohook-shared] uiohook-napi loaded successfully');
} catch (err) {
    loadError = err;
    console.warn('[uiohook-shared] uiohook-napi not available:', err.message);
}

/**
 * Ensure uiohook is started. Safe to call multiple times.
 * @returns {boolean} true if running
 */
function ensureStarted() {
    if (!uIOhook) return false;
    if (started) return true;
    try {
        uIOhook.start();
        started = true;
        console.log('[uiohook-shared] uiohook started');
        return true;
    } catch (err) {
        console.error('[uiohook-shared] Failed to start uiohook:', err);
        return false;
    }
}

/**
 * Stop uiohook. Call only on app shutdown.
 */
function stop() {
    if (uIOhook && started) {
        try {
            uIOhook.stop();
            started = false;
            console.log('[uiohook-shared] uiohook stopped');
        } catch (err) {
            // Ignore errors during cleanup
        }
    }
}

/** @returns {Object|null} The uIOhook instance or null */
function getHook() { return uIOhook; }

/** @returns {Object|null} UiohookKey enum or null */
function getKey() { return UiohookKey; }

/** @returns {boolean} Whether uiohook-napi loaded successfully */
function isAvailable() { return uIOhook !== null; }

/** @returns {boolean} Whether uiohook is currently running */
function isStarted() { return started; }

module.exports = { ensureStarted, stop, getHook, getKey, isAvailable, isStarted };
