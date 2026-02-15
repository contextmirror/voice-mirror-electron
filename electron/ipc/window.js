/**
 * IPC handlers for window control operations.
 * Handles: toggle-expand, minimize-window, get-window-position, set-window-position,
 *          get-cursor-position, start-drag-capture, stop-drag-capture, get-state,
 *          start-resize, stop-resize
 */

const { ipcMain, screen } = require('electron');

const VALID_RESIZE_EDGES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/**
 * Register window control IPC handlers.
 * @param {Object} ctx - Application context
 * @param {Object} validators - IPC input validators
 */
function registerWindowHandlers(ctx, validators) {
    // Local state for drag capture
    let preDragBounds = null;

    // Local state for resize
    let resizeInterval = null;
    let resizeEdge = null;

    ipcMain.handle('toggle-expand', () => {
        if (ctx.getIsExpanded()) {
            ctx.collapseToOrb();
        } else {
            ctx.expandPanel();
        }
        return { success: true, data: ctx.getIsExpanded() };
    });

    ipcMain.handle('get-state', () => {
        return { success: true, data: { expanded: ctx.getIsExpanded() } };
    });

    ipcMain.handle('minimize-window', () => {
        ctx.getMainWindow()?.minimize();
        return { success: true };
    });

    ipcMain.handle('get-window-position', () => {
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            return { success: true, data: { x, y } };
        }
        return { success: true, data: { x: 0, y: 0 } };
    });

    ipcMain.handle('set-window-position', (event, x, y) => {
        const v = validators['set-window-position'](x, y);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (mainWindow) {
            mainWindow.setPosition(v.value.x, v.value.y);
            return { success: true };
        }
        return { success: false };
    });

    // Get cursor position (for drag - mouse leaves small window)
    ipcMain.handle('get-cursor-position', () => {
        const point = screen.getCursorScreenPoint();
        return { success: true, data: { x: point.x, y: point.y } };
    });

    // Drag capture: temporarily expand window to catch mouse events
    // When orb is 64x64, mouse leaves immediately - this fixes that
    ipcMain.handle('start-drag-capture', () => {
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Save current bounds
        preDragBounds = mainWindow.getBounds();

        // Expand to large capture area centered on orb
        const captureSize = 800;
        const offsetX = (captureSize - preDragBounds.width) / 2;
        const offsetY = (captureSize - preDragBounds.height) / 2;

        mainWindow.setBounds({
            x: Math.round(preDragBounds.x - offsetX),
            y: Math.round(preDragBounds.y - offsetY),
            width: captureSize,
            height: captureSize
        });

        ctx.logger.info('[Window]', 'Drag capture started');
        return { success: true, originalBounds: preDragBounds };
    });

    ipcMain.handle('stop-drag-capture', (event, newX, newY) => {
        const v = validators['stop-drag-capture'](newX, newY);
        if (!v.valid) return { success: false, error: v.error };
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || ctx.getIsExpanded()) return { success: false };

        // Restore to orb size at new position
        const orbSize = ctx.getOrbSize();
        mainWindow.setBounds({
            x: v.value.newX,
            y: v.value.newY,
            width: orbSize,
            height: orbSize
        });

        // Save new position (async, don't block drag end)
        ctx.config.updateConfigAsync({ window: { orbX: v.value.newX, orbY: v.value.newY } });

        preDragBounds = null;
        ctx.logger.info('[Window]', 'Drag capture ended at', newX, newY);
        return { success: true };
    });

    // --- Frameless window resize via cursor polling ---

    ipcMain.handle('start-resize', (event, edge) => {
        if (typeof edge !== 'string' || !VALID_RESIZE_EDGES.includes(edge)) {
            return { success: false, error: 'Invalid edge' };
        }
        const mainWindow = ctx.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed() || !ctx.getIsExpanded()) {
            return { success: false };
        }

        // Stop any in-progress resize
        if (resizeInterval) {
            clearInterval(resizeInterval);
            resizeInterval = null;
        }

        resizeEdge = edge;
        const startBounds = mainWindow.getBounds();
        const startCursor = screen.getCursorScreenPoint();

        resizeInterval = setInterval(() => {
            if (!mainWindow || mainWindow.isDestroyed() || !ctx.getIsExpanded()) {
                clearInterval(resizeInterval);
                resizeInterval = null;
                return;
            }

            const cursor = screen.getCursorScreenPoint();
            const dx = cursor.x - startCursor.x;
            const dy = cursor.y - startCursor.y;

            let x = startBounds.x;
            let y = startBounds.y;
            let width = startBounds.width;
            let height = startBounds.height;

            if (resizeEdge.includes('e')) width = startBounds.width + dx;
            if (resizeEdge.includes('w')) { x = startBounds.x + dx; width = startBounds.width - dx; }
            if (resizeEdge.includes('s')) height = startBounds.height + dy;
            if (resizeEdge.includes('n')) { y = startBounds.y + dy; height = startBounds.height - dy; }

            // Enforce minimum size
            const [minW, minH] = mainWindow.getMinimumSize();
            if (width < minW) {
                if (resizeEdge.includes('w')) x = startBounds.x + startBounds.width - minW;
                width = minW;
            }
            if (height < minH) {
                if (resizeEdge.includes('n')) y = startBounds.y + startBounds.height - minH;
                height = minH;
            }

            mainWindow.setBounds({
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height)
            });
        }, 16); // ~60fps

        return { success: true };
    });

    ipcMain.handle('stop-resize', () => {
        if (resizeInterval) {
            clearInterval(resizeInterval);
            resizeInterval = null;
        }
        resizeEdge = null;
        return { success: true };
    });
}

module.exports = { registerWindowHandlers };
