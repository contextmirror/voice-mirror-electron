/**
 * browser-bookmarks.svelte.js -- Svelte 5 reactive store for browser bookmarks.
 *
 * Persists bookmarks to %APPDATA%/voice-mirror/browser-bookmarks.json via
 * Tauri commands (sibling of browser-history). Entries are newest-first.
 */

import { lensAddBookmark, lensRemoveBookmark, lensGetBookmarks } from '../api.js';

/**
 * @typedef {Object} BookmarkEntry
 * @property {string} url
 * @property {string} title
 * @property {number} timestamp - epoch millis
 */

function createBrowserBookmarksStore() {
  /** @type {BookmarkEntry[]} */
  let entries = $state([]);
  let loaded = false;

  async function init() {
    if (loaded) return;
    loaded = true;
    try {
      const result = await lensGetBookmarks();
      if (result?.data?.entries) {
        entries = result.data.entries;
      }
    } catch (err) {
      console.warn('[browser-bookmarks] Failed to load bookmarks:', err);
    }
  }

  return {
    get entries() { return entries; },

    init,

    /**
     * Is this URL bookmarked? Drives the address-bar star state.
     * @param {string} url
     */
    has(url) {
      return !!url && entries.some(e => e.url === url);
    },

    /**
     * Add (or re-title) a bookmark.
     * @param {string} url
     * @param {string} title
     */
    async add(url, title) {
      try {
        const result = await lensAddBookmark(url, title || url);
        if (result?.data?.entries) entries = result.data.entries;
      } catch (err) {
        console.warn('[browser-bookmarks] Failed to add bookmark:', err);
      }
    },

    /**
     * Remove a bookmark by URL.
     * @param {string} url
     */
    async remove(url) {
      try {
        const result = await lensRemoveBookmark(url);
        if (result?.data?.entries) entries = result.data.entries;
      } catch (err) {
        console.warn('[browser-bookmarks] Failed to remove bookmark:', err);
      }
    },

    /**
     * Toggle the bookmark state of a URL (star button).
     * @param {string} url
     * @param {string} title
     * @returns {Promise<boolean>} true if now bookmarked
     */
    async toggle(url, title) {
      if (this.has(url)) {
        await this.remove(url);
        return false;
      }
      await this.add(url, title);
      return true;
    },

    /**
     * Filter bookmarks by query (matches url or title, case-insensitive).
     * @param {string} query
     * @returns {BookmarkEntry[]}
     */
    filter(query) {
      if (!query) return entries;
      const q = query.toLowerCase();
      return entries.filter(e =>
        e.url?.toLowerCase().includes(q) || e.title?.toLowerCase().includes(q)
      );
    },
  };
}

export const browserBookmarksStore = createBrowserBookmarksStore();
export default browserBookmarksStore;
