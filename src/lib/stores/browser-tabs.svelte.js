/**
 * browser-tabs.svelte.js -- Svelte 5 reactive store for browser sub-tab management.
 *
 * Manages multiple WebView2 browser tabs inside the Lens preview panel.
 * Each tab has its own native WebView2 instance on the backend.
 */
import { lensCreateTab, lensCloseTab, lensSwitchTab, lensNavigate } from '../api.js';

const MAX_TABS = 8;
let counter = 0;

function createBrowserTabsStore() {
  let tabs = $state([]);
  let activeTabId = $state(null);
  /** Saved session waiting to be applied when the browser pane first opens */
  let pendingRestore = null;

  return {
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return tabs.find(t => t.id === activeTabId) || null; },
    get canAddTab() { return tabs.length < MAX_TABS; },

    /**
     * Open a new browser tab. Creates a WebView2 on the backend.
     * @param {string} url - Initial URL
     * @param {{ x: number, y: number, width: number, height: number }|null} bounds - WebView2 position
     * @returns {Promise<string|null>} Tab ID or null on failure
     */
    async openTab(url = 'about:blank', bounds = null) {
      if (tabs.length >= MAX_TABS) return null;

      const id = `btab-${Date.now()}-${++counter}`;
      const tab = {
        id,
        url,
        inputUrl: url,
        title: 'New Tab',
        webviewLabel: null,
        loading: false,
        favicon: null,
        canGoBack: false,
        canGoForward: false,
        certError: false,
        audible: false,
        muted: false,
      };

      tabs.push(tab);
      activeTabId = id;

      try {
        const x = bounds?.x ?? 0;
        const y = bounds?.y ?? 0;
        const width = bounds?.width ?? 800;
        const height = bounds?.height ?? 600;
        const result = await lensCreateTab(id, url, x, y, width, height);
        // Store the webview label returned from Rust (extract from IpcResponse)
        const t = tabs.find(t => t.id === id);
        if (t && result) {
          t.webviewLabel = result?.data?.label || result?.label || null;
        }
        return id;
      } catch (err) {
        console.error('[browser-tabs] Failed to create tab:', err);
        // Remove the tab on failure
        const idx = tabs.findIndex(t => t.id === id);
        if (idx !== -1) tabs.splice(idx, 1);
        // Restore active to previous or null
        if (activeTabId === id) {
          activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
        }
        return null;
      }
    },

    /**
     * Close a browser tab. Refuses if only 1 tab remains.
     * @param {string} id
     */
    async closeTab(id) {
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      // Determine the neighbor BEFORE removing (deterministic: prefer left, then right)
      let neighborId = null;
      if (activeTabId === id) {
        if (idx > 0) {
          neighborId = tabs[idx - 1].id;
        } else if (idx < tabs.length - 1) {
          neighborId = tabs[idx + 1].id;
        }
      }

      try {
        await lensCloseTab(id);
      } catch (err) {
        console.warn('[browser-tabs] Failed to close tab on backend:', err);
      }

      tabs.splice(idx, 1);

      // Switch to the neighbor on both frontend and backend
      if (neighborId) {
        activeTabId = neighborId;
        try {
          await lensSwitchTab(neighborId);
        } catch (err) {
          console.warn('[browser-tabs] Failed to switch after close:', err);
        }
      }
    },

    /**
     * Reset a tab back to blank (about:blank). Used when closing the last remaining tab.
     * @param {string} id
     */
    async resetTab(id) {
      const tab = tabs.find(t => t.id === id);
      if (!tab) return;

      try {
        await lensNavigate('about:blank');
      } catch (err) {
        console.warn('[browser-tabs] Failed to navigate to about:blank:', err);
      }

      tab.url = 'about:blank';
      tab.inputUrl = 'about:blank';
      tab.title = 'New Tab';
      tab.loading = false;
      tab.favicon = null;
      tab.canGoBack = false;
      tab.canGoForward = false;
      tab.certError = false;
      tab.audible = false;
      tab.muted = false;
    },

    /**
     * Switch to a different browser tab.
     * @param {string} id
     */
    async switchTab(id) {
      if (id === activeTabId) return;
      if (!tabs.find(t => t.id === id)) return;

      try {
        await lensSwitchTab(id);
      } catch (err) {
        console.warn('[browser-tabs] Failed to switch tab on backend:', err);
        return;
      }

      activeTabId = id;
    },

    /**
     * Reorder tabs by moving `draggedId` next to `targetId` (drag-to-reorder).
     * Pure frontend array move — the backend keys tabs by id, so order is a
     * UI-only concern. Dragging rightward drops after the target, leftward
     * before it, so a tab can be dragged all the way to either end.
     * @param {string} draggedId
     * @param {string} targetId
     */
    reorderTab(draggedId, targetId) {
      if (draggedId === targetId) return;
      const from = tabs.findIndex(t => t.id === draggedId);
      const to = tabs.findIndex(t => t.id === targetId);
      if (from === -1 || to === -1) return;
      const [moved] = tabs.splice(from, 1);
      const newTargetIdx = tabs.findIndex(t => t.id === targetId);
      const insertIdx = from < to ? newTargetIdx + 1 : newTargetIdx;
      tabs.splice(insertIdx, 0, moved);
    },

    /**
     * Set active tab directly (from MCP-initiated tab switch, no backend call needed).
     * @param {string} id
     */
    setActiveTabDirect(id) {
      if (tabs.find(t => t.id === id)) {
        activeTabId = id;
      }
    },

    /**
     * Update a tab's URL (from navigation events).
     * @param {string} tabId
     * @param {string} url
     */
    setTabUrl(tabId, url) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = url;
        tab.inputUrl = url;
        // A (re)navigation clears any prior certificate error for this tab.
        tab.certError = false;
      }
    },

    /**
     * Flag/clear a TLS certificate error for a tab (from lens-cert-error).
     * Drives the address-bar security chip to its error state.
     * @param {string} tabId
     * @param {boolean} hasError
     */
    setTabCertError(tabId, hasError) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.certError = !!hasError;
      }
    },

    /**
     * Update a tab's audio-playing state (ICoreWebView2_8
     * IsDocumentPlayingAudioChanged).
     * @param {string} tabId
     * @param {boolean} audible
     */
    setTabAudible(tabId, audible) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.audible = !!audible;
      }
    },

    /**
     * Update a tab's muted state (ICoreWebView2_8 IsMutedChanged / toggle).
     * @param {string} tabId
     * @param {boolean} muted
     */
    setTabMuted(tabId, muted) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.muted = !!muted;
      }
    },

    /**
     * Update a tab's title.
     * @param {string} tabId
     * @param {string} title
     */
    setTabTitle(tabId, title) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = title;
      }
    },

    /**
     * Update a tab's loading state.
     * @param {string} tabId
     * @param {boolean} loading
     */
    setTabLoading(tabId, loading) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.loading = loading;
      }
    },

    /**
     * Update a tab's favicon (from the WebView2 FaviconChanged event).
     * @param {string} tabId
     * @param {string|null} faviconUri
     */
    setTabFavicon(tabId, faviconUri) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.favicon = faviconUri || null;
      }
    },

    /**
     * Update a tab's navigation history state (from HistoryChanged).
     * @param {string} tabId
     * @param {boolean} canGoBack
     * @param {boolean} canGoForward
     */
    setTabHistoryState(tabId, canGoBack, canGoForward) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.canGoBack = !!canGoBack;
        tab.canGoForward = !!canGoForward;
      }
    },

    /**
     * Update only the input URL (for URL bar typing, before navigation).
     * @param {string} tabId
     * @param {string} url
     */
    setTabInputUrl(tabId, url) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.inputUrl = url;
      }
    },

    /**
     * Clear all tabs. Called on component unmount.
     */
    clearAll() {
      tabs.length = 0;
      activeTabId = null;
    },

    /**
     * Serialize the open tabs for workspace-state persistence.
     * Returns null when there's nothing worth restoring (blank tabs only).
     * @returns {{ tabs: Array<{url: string, title: string}>, activeIndex: number }|null}
     */
    serialize() {
      const real = tabs.filter(t => t.url && t.url !== 'about:blank');
      if (real.length === 0) return null;
      const activeIdx = real.findIndex(t => t.id === activeTabId);
      return {
        tabs: real.map(t => ({ url: t.url, title: t.title })),
        activeIndex: activeIdx === -1 ? 0 : activeIdx,
      };
    },

    /**
     * Stash a saved session to apply when the browser pane first opens.
     * Only honored before the first webview exists (app startup) — live
     * sessions are never clobbered.
     * @param {{ tabs?: Array<{url: string, title?: string}>, activeIndex?: number }|null} session
     */
    setPendingRestore(session) {
      pendingRestore = Array.isArray(session?.tabs) && session.tabs.length > 0
        ? session
        : null;
    },

    /**
     * Consume the pending session (one-shot).
     * @returns {{ tabs: Array<{url: string, title?: string}>, activeIndex?: number }|null}
     */
    takePendingRestore() {
      const s = pendingRestore;
      pendingRestore = null;
      return s;
    },

    /**
     * Get the active tab's webview label.
     * @returns {string|null}
     */
    getActiveWebviewLabel() {
      const tab = tabs.find(t => t.id === activeTabId);
      return tab?.webviewLabel || null;
    },
  };
}

export const browserTabsStore = createBrowserTabsStore();
