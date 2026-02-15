/**
 * resize.js - Custom resize handles for frameless transparent Electron window
 *
 * Electron transparent windows don't support native OS resize edges.
 * This module provides CSS-positioned resize edge divs that the user can
 * drag to resize the window via IPC calls to the main process.
 *
 * The main process polls the cursor position at ~60fps and updates
 * the window bounds accordingly, avoiding mouse-escape issues.
 */

import { createLog } from './log.js';
const log = createLog('[Resize]');

/**
 * Initialize resize edge event handlers.
 * Call once on app startup — edges are shown/hidden via CSS.
 */
export function initResize() {
    const edges = document.querySelectorAll('.resize-edge');
    if (!edges.length) return;

    edges.forEach(edge => {
        edge.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Extract direction from class (resize-n, resize-se, etc.)
            const match = edge.className.match(/resize-(nw|ne|sw|se|n|s|e|w)/);
            if (!match) return;
            const dir = match[1];

            // Tell main process to start polling cursor and resizing
            window.voiceMirror.startResize(dir);

            const onMouseUp = () => {
                window.voiceMirror.stopResize();
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mouseup', onMouseUp);
        });
    });

    log('Resize edges initialized');
}
