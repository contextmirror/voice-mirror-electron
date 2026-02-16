/**
 * Preload script for the log viewer window.
 * Exposes a minimal API for receiving log lines from the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logViewer', {
    onInitialLogs: (callback) => {
        const handler = (_e, content) => callback(content);
        ipcRenderer.on('initial-logs', handler);
        return () => ipcRenderer.removeListener('initial-logs', handler);
    },
    onLogLine: (callback) => {
        const handler = (_e, line) => callback(line);
        ipcRenderer.on('log-line', handler);
        return () => ipcRenderer.removeListener('log-line', handler);
    },
});
