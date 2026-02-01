/**
 * Cross-platform path helpers for services that can't access Electron's app API.
 */
const path = require('path');
const os = require('os');

/**
 * Get the Voice Mirror data directory (cross-platform).
 * Use this as a fallback when dataDir is not passed from main process.
 */
function getDataDir() {
    if (process.platform === 'win32') {
        const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(base, 'voice-mirror-electron', 'data');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'voice-mirror-electron', 'data');
    }
    return path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
}

module.exports = { getDataDir };
