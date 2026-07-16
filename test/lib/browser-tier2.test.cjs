/**
 * browser-tier2.test.cjs -- Source-inspection tests for the Tier 2
 * "feels like Chrome" batch: omnibox, security indicator, HTML5 fullscreen,
 * per-nav progress bar, find match counts, tab audio, tab reorder, permission
 * prompts, print.
 * See docs/design/browser-roadmap.md.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf-8');

const TABS_STORE = read('src', 'lib', 'stores', 'browser-tabs.svelte.js');
const TAB_BAR = read('src', 'components', 'lens', 'browser', 'BrowserTabBar.svelte');
const TOOLBAR = read('src', 'components', 'lens', 'LensToolbar.svelte');
const WORKSPACE = read('src', 'components', 'lens', 'LensWorkspace.svelte');
const PREVIEW = read('src', 'components', 'lens', 'preview', 'LensPreview.svelte');
const FINDBAR = read('src', 'components', 'lens', 'browser', 'FindBar.svelte');
const WEBVIEW_SETUP = read('src-tauri', 'src', 'commands', 'lens', 'webview_setup.rs');
const FIND_RS = read('src-tauri', 'src', 'commands', 'lens', 'find.rs');
const LIB_RS = read('src-tauri', 'src', 'lib.rs');
const API_JS = read('src', 'lib', 'api.js');
const APP_SVELTE = read('src', 'App.svelte');

describe('browser tier2: omnibox', () => {
  it('toolbar builds suggestions from history + bookmarks', () => {
    assert.ok(TOOLBAR.includes('browserHistoryStore'), 'Should read history store');
    assert.ok(TOOLBAR.includes('browserBookmarksStore.filter'), 'Should filter bookmarks');
    assert.ok(TOOLBAR.includes('browserHistoryStore.filter'), 'Should filter history');
    assert.ok(TOOLBAR.includes('omnibox-suggestions'), 'Should render the dropdown');
  });

  it('supports keyboard nav (up/down/enter/escape)', () => {
    assert.ok(TOOLBAR.includes('handleUrlKeydown'), 'Should have a keydown handler');
    assert.ok(TOOLBAR.includes("'ArrowDown'"), 'Should handle ArrowDown');
    assert.ok(TOOLBAR.includes("'ArrowUp'"), 'Should handle ArrowUp');
    assert.ok(TOOLBAR.includes("'Escape'"), 'Should handle Escape');
    assert.ok(TOOLBAR.includes('selectedIndex'), 'Should track a highlighted row');
  });

  it('freezes the webview while the dropdown is open (airspace)', () => {
    assert.ok(TOOLBAR.includes('suggestionsOpen = $bindable'), 'Toolbar exposes bindable open-state');
    assert.ok(WORKSPACE.includes('bind:suggestionsOpen={omniboxOpen}'), 'Workspace binds the open-state');
    assert.ok(WORKSPACE.includes('omniboxOpen'), 'Workspace freezes on omniboxOpen');
    assert.ok(
      /showDownloads \|\| omniboxOpen/.test(WORKSPACE),
      'omniboxOpen should be folded into the freeze effect'
    );
  });
});
