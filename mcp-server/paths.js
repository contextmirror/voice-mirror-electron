/**
 * Shared paths and constants for MCP server handlers.
 */

const path = require('path');
const os = require('os');

const HOME_DATA_DIR = path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
const CLAUDE_MESSAGES_PATH = path.join(HOME_DATA_DIR, 'inbox.json');
const CLAUDE_STATUS_PATH = path.join(HOME_DATA_DIR, 'status.json');
const LISTENER_LOCK_PATH = path.join(HOME_DATA_DIR, 'listener_lock.json');

const STALE_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes
const AUTO_CLEANUP_HOURS = 24;
const LISTENER_LOCK_TIMEOUT_MS = 70 * 1000;  // Lock expires after 70s

module.exports = {
    HOME_DATA_DIR,
    CLAUDE_MESSAGES_PATH,
    CLAUDE_STATUS_PATH,
    LISTENER_LOCK_PATH,
    STALE_TIMEOUT_MS,
    AUTO_CLEANUP_HOURS,
    LISTENER_LOCK_TIMEOUT_MS
};
