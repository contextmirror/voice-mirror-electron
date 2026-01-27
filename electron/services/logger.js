/**
 * File logging service for Voice Mirror Electron.
 * Writes color-coded logs to vmr.log in the config data directory.
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for logs
const Colors = {
    RESET: '\x1b[0m',
    DIM: '\x1b[2m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
};

// Log level styles: [color, icon]
const LOG_STYLES = {
    'APP': [Colors.GREEN, '⚡'],
    'CONFIG': [Colors.YELLOW, '⚙'],
    'PYTHON': [Colors.MAGENTA, '🐍'],
    'CLAUDE': [Colors.BLUE, '🤖'],
    'EVENT': [Colors.CYAN, '→'],
    'ERROR': [Colors.RED, '✗'],
    'LOG': [Colors.WHITE, '•'],
};

/**
 * Create a logger instance.
 * @param {Object} options - Logger options
 * @param {string} options.dataDir - Directory to store log file (defaults to ~/.config/voice-mirror-electron/data)
 * @returns {Object} Logger instance with init, log, and close methods
 */
function createLogger(options = {}) {
    let logFile = null;
    let logFilePath = null;

    /**
     * Initialize the log file.
     * Creates the data directory if needed and opens the log file.
     */
    function init() {
        try {
            const dataDir = options.dataDir || path.join(
                process.env.HOME || process.env.USERPROFILE,
                '.config', 'voice-mirror-electron', 'data'
            );

            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            logFilePath = path.join(dataDir, 'vmr.log');
            // Truncate log file on startup (keep it fresh each session)
            logFile = fs.createWriteStream(logFilePath, { flags: 'w' });
            log('APP', 'Voice Mirror started');
        } catch (err) {
            console.error('Failed to init log file:', err);
        }
    }

    /**
     * Write a log message with color-coded output.
     * @param {string} level - Log level (APP, CONFIG, PYTHON, CLAUDE, EVENT, ERROR, LOG)
     * @param {string} message - Message to log
     */
    function log(level, message) {
        const now = new Date();
        const timestamp = now.toTimeString().slice(0, 8); // HH:MM:SS
        const [color, icon] = LOG_STYLES[level] || [Colors.WHITE, '•'];

        // Color-coded log line
        const logLine = `${Colors.DIM}[${timestamp}]${Colors.RESET} ${color}${icon} ${message}${Colors.RESET}`;

        // Write to console
        if (level === 'ERROR') {
            console.error(logLine);
        } else {
            console.log(logLine);
        }

        // Write to file
        if (logFile) {
            logFile.write(logLine + '\n');
        }
    }

    /**
     * Close the log file.
     */
    function close() {
        if (logFile) {
            logFile.end();
            logFile = null;
        }
    }

    /**
     * Get the path to the log file.
     * @returns {string|null} Log file path or null if not initialized
     */
    function getLogFilePath() {
        return logFilePath;
    }

    return {
        init,
        log,
        close,
        getLogFilePath,
        // Expose log levels for reference
        levels: Object.keys(LOG_STYLES)
    };
}

// Export factory function and constants
module.exports = {
    createLogger,
    Colors,
    LOG_STYLES
};
