/**
 * resize.js - Custom resize handles for frameless transparent Electron window
 *
 * Electron transparent windows don't support native OS resize edges.
 * This module uses the Pointer Capture API so all drag tracking stays
 * in the renderer — no main-process polling intervals, no race conditions.
 *
 * Flow: pointerdown → capture pointer → pointermove (throttled via rAF)
 *       → IPC send to setBounds → pointerup → release + save size
 */

import { createLog } from './log.js';
const log = createLog('[Resize]');

const MIN_WIDTH = 300;
const MIN_HEIGHT = 400;

/**
 * Initialize resize edge event handlers.
 * Call once on app startup — edges are shown/hidden via CSS class toggle.
 */
export function initResize() {
    const edges = document.querySelectorAll('.resize-edge');
    if (!edges.length) return;

    edges.forEach(edge => {
        edge.addEventListener('pointerdown', async (e) => {
            if (e.button !== 0) return; // left-click only
            e.preventDefault();
            e.stopPropagation();

            // Determine direction from classList
            const dirs = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
            const dir = dirs.find(d => edge.classList.contains(`resize-${d}`));
            if (!dir) return;

            // Capture pointer — events fire on this element even if cursor leaves window
            edge.setPointerCapture(e.pointerId);

            // Snapshot initial window bounds
            const result = await window.voiceMirror.getWindowBounds();
            if (!result.success) return;
            const startBounds = result.data;
            const startX = e.screenX;
            const startY = e.screenY;

            let rafId = null;
            let latestX = startX;
            let latestY = startY;

            const applyResize = () => {
                rafId = null;
                const dx = latestX - startX;
                const dy = latestY - startY;

                let x = startBounds.x;
                let y = startBounds.y;
                let w = startBounds.width;
                let h = startBounds.height;

                if (dir.includes('e')) w = startBounds.width + dx;
                if (dir.includes('w')) { x = startBounds.x + dx; w = startBounds.width - dx; }
                if (dir.includes('s')) h = startBounds.height + dy;
                if (dir.includes('n')) { y = startBounds.y + dy; h = startBounds.height - dy; }

                // Enforce minimums
                if (w < MIN_WIDTH) {
                    if (dir.includes('w')) x = startBounds.x + startBounds.width - MIN_WIDTH;
                    w = MIN_WIDTH;
                }
                if (h < MIN_HEIGHT) {
                    if (dir.includes('n')) y = startBounds.y + startBounds.height - MIN_HEIGHT;
                    h = MIN_HEIGHT;
                }

                window.voiceMirror.setWindowBounds(
                    Math.round(x), Math.round(y), Math.round(w), Math.round(h)
                );
            };

            const onMove = (ev) => {
                latestX = ev.screenX;
                latestY = ev.screenY;
                if (!rafId) rafId = requestAnimationFrame(applyResize);
            };

            const cleanup = () => {
                edge.removeEventListener('pointermove', onMove);
                edge.removeEventListener('pointerup', onEnd);
                edge.removeEventListener('lostpointercapture', cleanup);
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                // Persist final panel size to config
                window.voiceMirror.saveWindowBounds();
            };

            const onEnd = (ev) => {
                try { edge.releasePointerCapture(ev.pointerId); } catch {}
                cleanup();
            };

            edge.addEventListener('pointermove', onMove);
            edge.addEventListener('pointerup', onEnd);
            edge.addEventListener('lostpointercapture', cleanup);
        });
    });

    log.info('Resize edges initialized');
}
