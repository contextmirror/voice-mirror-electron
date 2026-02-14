/**
 * Preload script for the log viewer window.
 * Exposes a minimal API for receiving log lines from the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logViewer', {
    onInitialLogs: (callback) => ipcRenderer.on('initial-logs', (_e, content) => callback(content)),
    onLogLine: (callback) => ipcRenderer.on('log-line', (_e, line) => callback(line)),
});
