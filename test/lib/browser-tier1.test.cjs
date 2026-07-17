/**
 * browser-tier1.test.cjs -- Source-inspection tests for the Tier 1
 * "proper browser" batch: favicons, native back/forward, session restore,
 * bookmarks, download config wiring + persistence.
 * See docs/design/browser-roadmap.md.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf-8');

const TABS_STORE = read('src', 'lib', 'stores', 'browser-tabs.svelte.js');
const BOOKMARKS_STORE = read('src', 'lib', 'stores', 'browser-bookmarks.svelte.js');
const WS_STATE = read('src', 'lib', 'stores', 'workspace-state.svelte.js');
const TAB_BAR = read('src', 'components', 'lens', 'browser', 'BrowserTabBar.svelte');
const TOOLBAR = read('src', 'components', 'lens', 'LensToolbar.svelte');
const PREVIEW = read('src', 'components', 'lens', 'preview', 'LensPreview.svelte');
const WEBVIEW_SETUP = read('src-tauri', 'src', 'commands', 'lens', 'webview_setup.rs');
const NAVIGATION = read('src-tauri', 'src', 'commands', 'lens', 'navigation.rs');
const BOOKMARKS_RS = read('src-tauri', 'src', 'commands', 'lens', 'bookmarks.rs');
const DOWNLOADS_RS = read('src-tauri', 'src', 'commands', 'lens', 'downloads.rs');
const LIB_RS = read('src-tauri', 'src', 'lib.rs');

describe('browser tier1: favicons + spinners', () => {
  it('Rust registers FaviconChanged and HistoryChanged handlers', () => {
    assert.ok(WEBVIEW_SETUP.includes('add_FaviconChanged'), 'FaviconChanged should be registered');
    assert.ok(WEBVIEW_SETUP.includes('add_HistoryChanged'), 'HistoryChanged should be registered');
    assert.ok(WEBVIEW_SETUP.includes('lens-favicon-changed'), 'Should emit lens-favicon-changed');
    assert.ok(WEBVIEW_SETUP.includes('lens-history-changed'), 'Should emit lens-history-changed');
    assert.ok(WEBVIEW_SETUP.includes('register_navigation_state_handlers(&app_for_download, &webview_ref, &tab_id_clone)'), 'Handlers should be attached per tab');
  });

  it('tab store carries favicon and history state per tab', () => {
    assert.ok(TABS_STORE.includes('favicon: null'), 'Tab shape should include favicon');
    assert.ok(TABS_STORE.includes('setTabFavicon'), 'Should expose setTabFavicon');
    assert.ok(TABS_STORE.includes('setTabHistoryState'), 'Should expose setTabHistoryState');
  });

  it('tab strip renders favicon, globe fallback, and loading spinner', () => {
    assert.ok(TAB_BAR.includes('browser-tab-favicon'), 'Should render favicon img');
    assert.ok(TAB_BAR.includes('browser-tab-spinner'), 'Should render loading spinner');
    assert.ok(TAB_BAR.includes('browser-tab-globe'), 'Should render globe fallback');
  });

  it('LensPreview routes the new events into the store', () => {
    assert.ok(PREVIEW.includes("listen('lens-favicon-changed'"), 'Should listen for favicons');
    assert.ok(PREVIEW.includes("listen('lens-history-changed'"), 'Should listen for history state');
  });
});

describe('browser tier1: native back/forward', () => {
  it('uses native GoBack/GoForward instead of history.back() evals', () => {
    assert.ok(NAVIGATION.includes('core.GoForward()'), 'Should call native GoForward');
    assert.ok(NAVIGATION.includes('core.GoBack()'), 'Should call native GoBack');
    // The old implementation eval'd `history.back(); setTimeout(...)` scripts —
    // match the executable form (semicolon), not the doc-comment mention.
    assert.ok(!NAVIGATION.includes('history.back();'), 'history.back() eval must be gone');
    assert.ok(!NAVIGATION.includes('history.forward();'), 'history.forward() eval must be gone');
  });

  it('toolbar buttons disable from real canGoBack/canGoForward', () => {
    assert.ok(TOOLBAR.includes('disabled={!canGoBack}'), 'Back should disable');
    assert.ok(TOOLBAR.includes('disabled={!canGoForward}'), 'Forward should disable');
  });
});

describe('browser tier1: session restore', () => {
  it('workspace-state persists and restores the browser session', () => {
    assert.ok(WS_STATE.includes('browserSession: browserTabsStore.serialize()'), 'Should serialize browser tabs');
    assert.ok(WS_STATE.includes('setPendingRestore'), 'Should stash session for restore');
  });

  it('tab store serializes real tabs only and restores one-shot', () => {
    assert.ok(TABS_STORE.includes("t.url !== 'about:blank'"), 'Blank tabs should not persist');
    assert.ok(TABS_STORE.includes('takePendingRestore'), 'Restore should be one-shot');
  });

  it('LensPreview restores the session instead of a blank first tab', () => {
    assert.ok(PREVIEW.includes('takePendingRestore()'), 'First-tab creation should consume the saved session');
  });
});

describe('browser tier1: bookmarks', () => {
  it('Rust bookmark commands exist and are registered', () => {
    assert.ok(BOOKMARKS_RS.includes('browser-bookmarks.json'), 'Should persist to browser-bookmarks.json');
    for (const cmd of ['lens_add_bookmark', 'lens_remove_bookmark', 'lens_get_bookmarks']) {
      assert.ok(LIB_RS.includes(`lens_cmds::bookmarks::${cmd}`), `${cmd} should be in the invoke handler`);
    }
  });

  it('add replaces same-URL bookmark instead of duplicating', () => {
    assert.ok(BOOKMARKS_RS.includes('entries.retain'), 'Add should de-duplicate by URL');
  });

  it('toolbar has a star that reflects bookmark state', () => {
    assert.ok(TOOLBAR.includes('star-btn'), 'Star button should exist');
    assert.ok(TOOLBAR.includes('browserBookmarksStore.has(currentUrl)'), 'Star should reflect state');
  });

  it('bookmarks store exposes toggle/has/filter', () => {
    for (const m of ['has(url)', 'async add(url, title)', 'async toggle(url, title)', 'filter(query)']) {
      assert.ok(BOOKMARKS_STORE.includes(m), `Store should expose ${m}`);
    }
  });
});

describe('browser tier1: downloads', () => {
  it('lets WebView2 handle downloads natively (observe-only)', () => {
    assert.ok(WEBVIEW_SETUP.includes('args.SetHandled(false)'), 'Handler must not intercept — native download UI');
    assert.ok(!WEBVIEW_SETUP.includes('SetResultFilePath'), 'Must not redirect the download target');
    assert.ok(!WEBVIEW_SETUP.includes('download_ask_location'), 'Config-driven interception was reverted');
  });

  it('persists finished downloads across restarts', () => {
    assert.ok(DOWNLOADS_RS.includes('browser-downloads.json'), 'Should persist to browser-downloads.json');
    assert.ok(DOWNLOADS_RS.includes('pub(crate) fn load_persisted'), 'Startup seed should be loadable');
    assert.ok(WEBVIEW_SETUP.includes('persist_finished(&guard)'), 'Completion should persist');
    assert.ok(LIB_RS.includes('lens_cmds::downloads::load_persisted()'), 'LensState should seed from disk');
  });
});
