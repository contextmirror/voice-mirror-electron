/**
 * Voice Mirror Memory System - Utilities
 * Shared helper functions for the memory subsystem
 */

const crypto = require('crypto');
const path = require('path');
const os = require('os');

/**
 * Get the memory directory path based on platform
 * @returns {string} Path to memory directory
 */
function getMemoryDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'voice-mirror-electron', 'memory');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'memory');
    } else {
        // Linux and others
        return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'memory');
    }
}

/**
 * Get the data directory path (for inbox, etc.)
 * @returns {string} Path to data directory
 */
function getDataDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'voice-mirror-electron', 'data');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'data');
    } else {
        return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
    }
}

/**
 * Get the cache directory for models
 * @returns {string} Path to model cache directory
 */
function getModelCacheDir() {
    const platform = process.platform;

    if (platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'voice-mirror', 'models');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Caches', 'voice-mirror', 'models');
    } else {
        return path.join(os.homedir(), '.cache', 'voice-mirror', 'models');
    }
}

/**
 * Calculate SHA-256 hash of text
 * @param {string} text - Text to hash
 * @returns {string} Hex-encoded hash
 */
function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Generate a unique ID with prefix
 * @param {string} prefix - ID prefix (e.g., 'chunk', 'mem')
 * @returns {string} Unique ID
 */
function generateId(prefix = 'id') {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
}

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get current time in HH:MM format
 * @returns {string} Time string
 */
function getCurrentTime() {
    return new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

/**
 * Estimate token count from text (rough approximation)
 * ~4 characters per token for English text
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, ms) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Normalize text for embedding comparison
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Truncate text to max length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLength = 200) {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

module.exports = {
    getMemoryDir,
    getDataDir,
    getModelCacheDir,
    sha256,
    generateId,
    getTodayDate,
    getCurrentTime,
    estimateTokens,
    debounce,
    normalizeText,
    truncate
};
