/**
 * Log viewer window service.
 * Opens a dedicated BrowserWindow showing live application logs.
 * Factory pattern: createLogViewer() returning { toggle(), isOpen() }.
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createLogViewer({ logger, getMainWindow }) {
    let window = null;
    let listener = null;

    function toggle() {
        if (window && !window.isDestroyed()) {
            window.focus();
            return;
        }

        window = new BrowserWindow({
            width: 900,
            height: 500,
            minWidth: 500,
            minHeight: 300,
            title: 'Voice Mirror - Logs',
            icon: path.join(__dirname, '..', '..', 'assets', 'icon-256.png'),
            backgroundColor: '#0c0d10',
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                preload: path.join(__dirname, '..', 'preload-log-viewer.js')
            }
        });

        window.setMenuBarVisibility(false);

        window.loadFile(path.join(__dirname, '..', 'log-viewer.html'));

        window.once('ready-to-show', () => {
            // Send existing log content
            const logPath = logger.getLogPath();
            if (logPath && fs.existsSync(logPath)) {
                try {
                    const content = fs.readFileSync(logPath, 'utf-8');
                    if (!window.isDestroyed()) {
                        window.webContents.send('initial-logs', content);
                    }
                } catch { /* file read error */ }
            }

            // Register listener for live log lines
            listener = (logLine) => {
                if (window && !window.isDestroyed()) {
                    window.webContents.send('log-line', logLine);
                }
            };
            logger.addListener(listener);

            window.show();
        });

        window.on('closed', () => {
            if (listener) {
                logger.removeListener(listener);
                listener = null;
            }
            window = null;
        });
    }

    function isOpen() {
        return window !== null && !window.isDestroyed();
    }

    return { toggle, isOpen };
}

module.exports = { createLogViewer };
