/**
 * IPC handlers for screen capture operations.
 * Handles: get-screens, capture-screen, supports-vision
 */

const { app, ipcMain, desktopCapturer, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { captureDisplayWindows } = require('../lib/windows-screen-capture');

/**
 * Register screen-related IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerScreenHandlers(ctx, validators) {
    ipcMain.handle('get-screens', async () => {
        const displays = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();

        // On Windows multi-monitor, use native PowerShell capture for accurate thumbnails
        // (Electron desktopCapturer returns same image for all displays)
        if (process.platform === 'win32' && displays.length > 1) {
            const tmpDir = app.getPath('temp');
            const results = [];
            for (let i = 0; i < displays.length; i++) {
                const d = displays[i];
                const isPrimary = d.id === primary.id;
                const tmpPath = path.join(tmpDir, `vm-thumb-${i}.png`);
                const ok = await captureDisplayWindows(i, tmpPath);
                let thumbnail = '';
                if (ok && fs.existsSync(tmpPath)) {
                    const img = nativeImage.createFromPath(tmpPath);
                    thumbnail = img.resize({ width: 320 }).toDataURL();
                    try { fs.unlinkSync(tmpPath); } catch {}
                }
                results.push({
                    id: `display:${i}`,
                    name: `Screen ${i + 1} (${d.size.width}x${d.size.height})${isPrimary ? ' - Primary' : ''}`,
                    thumbnail
                });
            }
            return { success: true, data: results };
        }

        // Fallback: use desktopCapturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 320, height: 180 }
        });
        return { success: true, data: sources.map((s, i) => ({
            id: s.id,
            name: s.name || `Screen ${i + 1}`,
            thumbnail: s.thumbnail.toDataURL()
        })) };
    });

    ipcMain.handle('capture-screen', async (_event, sourceId) => {
        // Validate sourceId format if provided
        if (sourceId !== undefined && sourceId !== null) {
            if (typeof sourceId !== 'string' || sourceId.length > 200) {
                return { success: false, error: 'sourceId must be a string (max 200 chars)' };
            }
            if (!/^(screen:|display:|window:)/.test(sourceId)) {
                return { success: false, error: 'sourceId must start with "screen:", "display:", or "window:"' };
            }
        }
        // Windows native capture for multi-monitor (display:N format from get-screens)
        if (process.platform === 'win32' && typeof sourceId === 'string' && sourceId.startsWith('display:')) {
            const displayIndex = parseInt(sourceId.split(':')[1], 10) || 0;
            const tmpPath = path.join(app.getPath('temp'), `vm-capture-${Date.now()}.png`);
            const ok = await captureDisplayWindows(displayIndex, tmpPath);
            if (ok && fs.existsSync(tmpPath)) {
                const img = nativeImage.createFromPath(tmpPath);
                const dataUrl = img.toDataURL();
                try { fs.unlinkSync(tmpPath); } catch {}
                return { success: true, data: dataUrl };
            }
        }

        // Fallback: use desktopCapturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        const source = sourceId
            ? sources.find(s => s.id === sourceId) || sources[0]
            : sources[0];
        if (source) {
            return { success: true, data: source.thumbnail.toDataURL() };
        }
        return { success: false, error: 'No screen source available' };
    });

    ipcMain.handle('supports-vision', () => {
        const aiManager = ctx.getAIManager();
        // Claude Code always supports vision via MCP screen capture
        if (aiManager && aiManager.isClaudeRunning()) return { success: true, data: true };
        const provider = aiManager && aiManager.getProvider();
        if (provider && provider.supportsVision) return { success: true, data: provider.supportsVision() };
        return { success: true, data: false };
    });
}

module.exports = { registerScreenHandlers };
