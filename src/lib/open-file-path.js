/**
 * open-file-path.js -- Pure path resolution for shell "Open with" requests.
 *
 * Maps an absolute OS path (from Explorer / the command line) onto a
 * tabsStore.openFile() entry. Files inside the active project open as
 * normal workspace tabs (root-relative, forward-slash path — the same shape
 * FileTree produces); anything else opens as an external read-only tab
 * (same rules as LSP go-to-definition into a dependency).
 */

import { basename } from './utils.js';

/**
 * Build a tab entry for an absolute file path.
 * @param {string} absPath - Absolute OS path (either slash style)
 * @param {string|null} root - Active project root, or null if none
 * @returns {{ name: string, path: string, external: boolean, readOnly: boolean }}
 */
export function entryForOpenPath(absPath, root) {
  const filePath = String(absPath).replace(/\\/g, '/');
  const name = basename(filePath);
  if (root) {
    const normalizedRoot = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
    if (filePath.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/')) {
      return {
        name,
        path: filePath.slice(normalizedRoot.length + 1),
        external: false,
        readOnly: false,
      };
    }
  }
  return { name, path: filePath, external: true, readOnly: true };
}
