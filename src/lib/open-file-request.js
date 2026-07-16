/**
 * open-file-request.js -- "Open with Voice Mirror" from the OS shell.
 *
 * Double-clicking an associated file in Explorer launches
 * `voice-mirror.exe "<path>"`. Two delivery paths converge here:
 * - fresh launch: Rust stashes the argv file paths in managed state; we
 *   drain them via takeStartupOpenPaths() after the workspace restores so
 *   the file lands focused on top of the restored tabs.
 * - already running: the single-instance plugin forwards the second
 *   launch's argv and Rust emits an `open-file-request` event per file.
 *
 * Both paths switch to the lens (IDE) view so the opened tab is visible.
 */

import { listen } from '@tauri-apps/api/event';
import { takeStartupOpenPaths } from './api.js';
import { unwrapResult } from './utils.js';
import { entryForOpenPath } from './open-file-path.js';
import { tabsStore } from './stores/tabs.svelte.js';
import { projectStore } from './stores/project.svelte.js';
import { navigationStore } from './stores/navigation.svelte.js';
import { auditEditor } from './audit-log.js';

/** Open one absolute path in the editor, surfacing the lens view. */
function openRequestedPath(absPath) {
  const entry = entryForOpenPath(absPath, projectStore.root);
  auditEditor('shell-open-request', { path: absPath, external: entry.external });
  navigationStore.setView('lens');
  tabsStore.openFile(entry);
}

/**
 * Listen for open requests forwarded from a second app launch.
 * @returns {Promise<() => void>} unlisten
 */
export function initOpenFileRequestListener() {
  return listen('open-file-request', (event) => {
    const path = event.payload?.path;
    if (path) openRequestedPath(path);
  });
}

/**
 * Drain and open the file paths this launch was started with.
 * Call once, after projectStore.init + workspace restore.
 */
export async function drainStartupOpenPaths() {
  try {
    const paths = unwrapResult(await takeStartupOpenPaths(), []);
    for (const p of Array.isArray(paths) ? paths : []) {
      openRequestedPath(p);
    }
  } catch {
    // Non-Tauri context (tests/browser) or command failure — nothing to open.
  }
}
