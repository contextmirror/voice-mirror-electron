/**
 * browser-extensions.svelte.js -- shared state for installed browser extensions.
 *
 * Single source of truth so the toolbar's extension buttons and the Extensions
 * settings panel stay in sync. WebView2 renders no extension UI, so the toolbar
 * opens each extension's popup (`chrome-extension://<id>/<popup>`) in a new tab
 * itself; that only works for extensions whose manifest declares a popup path.
 */
import { lensExtensionsList } from '../api.js';

class BrowserExtensionsStore {
  /** @type {Array<{id:string,name:string,enabled:boolean,popup:string,dir:string}>} */
  extensions = $state([]);
  /** Last error surfaced by a refresh (e.g. "restart to enable extensions"). */
  lastError = $state('');

  /** Replace the list (called by the settings panel after a mutation). */
  set(list) {
    if (Array.isArray(list)) this.extensions = list;
  }

  /** Fetch the live list from the backend. Silent — callers decide on UI. */
  async refresh() {
    try {
      const res = await lensExtensionsList();
      if (res?.success && Array.isArray(res.data?.extensions)) {
        this.extensions = res.data.extensions;
        this.lastError = '';
      } else if (res && !res.success) {
        this.lastError = res.error || '';
      }
    } catch (e) {
      this.lastError = String(e);
    }
  }

  /** Enabled extensions that expose a popup — the only ones we can button-ify. */
  get withPopup() {
    return this.extensions.filter((e) => e.enabled && e.popup);
  }
}

export const browserExtensionsStore = new BrowserExtensionsStore();
