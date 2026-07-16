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
const AUDIO_RS = read('src-tauri', 'src', 'commands', 'lens', 'audio.rs');
const PERMISSIONS_RS = read('src-tauri', 'src', 'commands', 'lens', 'permissions.rs');
const MOD_RS = read('src-tauri', 'src', 'commands', 'lens', 'mod.rs');
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

describe('browser tier2: security indicator', () => {
  it('toolbar derives a padlock/warning/error chip from the active tab', () => {
    assert.ok(TOOLBAR.includes('security-chip'), 'Should render a security chip');
    assert.ok(/security === 'secure'/.test(TOOLBAR), 'https → secure');
    assert.ok(/security === 'insecure'|'insecure'/.test(TOOLBAR), 'http → insecure');
    assert.ok(TOOLBAR.includes('certError'), 'cert error feeds the chip');
  });

  it('Rust registers a ServerCertificateErrorDetected handler', () => {
    assert.ok(WEBVIEW_SETUP.includes('add_ServerCertificateErrorDetected'), 'Should register the cert handler');
    assert.ok(WEBVIEW_SETUP.includes('lens-cert-error'), 'Should emit lens-cert-error');
    assert.ok(WEBVIEW_SETUP.includes('register_cert_error_handler(&app_for_download'), 'Handler attached per tab');
  });

  it('cert error flows into the tab store and clears on navigation', () => {
    assert.ok(TABS_STORE.includes('setTabCertError'), 'store exposes setTabCertError');
    assert.ok(/certError = false/.test(TABS_STORE), 'navigation clears the cert error');
    assert.ok(PREVIEW.includes("listen('lens-cert-error'"), 'LensPreview routes the event');
  });
});

describe('browser tier2: HTML5 fullscreen', () => {
  it('Rust registers ContainsFullScreenElementChanged and emits an event', () => {
    assert.ok(WEBVIEW_SETUP.includes('add_ContainsFullScreenElementChanged'), 'Should register the handler');
    assert.ok(WEBVIEW_SETUP.includes('lens-fullscreen-changed'), 'Should emit lens-fullscreen-changed');
    assert.ok(WEBVIEW_SETUP.includes('register_fullscreen_handler(&app_for_download'), 'Handler attached per tab');
  });

  it('LensPreview fills the window while fullscreen and restores on exit', () => {
    assert.ok(PREVIEW.includes("listen('lens-fullscreen-changed'"), 'Should route the event');
    assert.ok(PREVIEW.includes('isFullscreen'), 'Should track fullscreen state');
    assert.ok(PREVIEW.includes('window.innerWidth, window.innerHeight'), 'Should fill the window');
    assert.ok(/isFullscreen && lensStore.webviewReady/.test(PREVIEW), 'syncBounds honors fullscreen');
  });
});

describe('browser tier2: per-nav progress bar', () => {
  it('Rust drives per-tab loading from page-load Started/Finished', () => {
    assert.ok(WEBVIEW_SETUP.includes('lens-loading-changed'), 'Should emit lens-loading-changed');
    assert.ok(WEBVIEW_SETUP.includes('PageLoadEvent::Started'), 'Should emit on load start');
    assert.ok(/"loading": true/.test(WEBVIEW_SETUP), 'Started → loading true');
    assert.ok(/"loading": false/.test(WEBVIEW_SETUP), 'Finished → loading false');
  });

  it('LensPreview routes loading into the store and the bar renders on loading', () => {
    assert.ok(PREVIEW.includes("listen('lens-loading-changed'"), 'Should route the event');
    assert.ok(WORKSPACE.includes('nav-progress'), 'Should render the progress bar');
    assert.ok(WORKSPACE.includes('browserTabsStore.activeTab?.loading'), 'Bar gated on active-tab loading');
  });
});

describe('browser tier2: find match counts', () => {
  it('find commands return {found, total} via a JS-side count', () => {
    assert.ok(FIND_RS.includes('fn find_js'), 'Should build a combined find+count script');
    assert.ok(FIND_RS.includes('total'), 'Should count total matches');
    assert.ok(/"found": found, "total": total/.test(FIND_RS), 'Should return found + total');
    assert.ok(FIND_RS.includes('innerText'), 'Count scans rendered text');
  });

  it('FindBar shows current/total and tracks the active match', () => {
    assert.ok(FINDBAR.includes('find-count'), 'Should render the count');
    assert.ok(FINDBAR.includes('countLabel'), 'Should compute a current/total label');
    assert.ok(/res\?\.data\?\.total/.test(FINDBAR), 'Should read total from the response');
    assert.ok(FINDBAR.includes('No results'), 'Should show a no-results state');
  });
});

describe('browser tier2: tab audio', () => {
  it('Rust registers audio-state handlers and a mute command', () => {
    assert.ok(WEBVIEW_SETUP.includes('add_IsDocumentPlayingAudioChanged'), 'Should register audio-playing handler');
    assert.ok(WEBVIEW_SETUP.includes('add_IsMutedChanged'), 'Should register muted handler');
    assert.ok(WEBVIEW_SETUP.includes('lens-audio-state'), 'Should emit lens-audio-state');
    assert.ok(WEBVIEW_SETUP.includes('register_audio_handlers(&app_for_download'), 'Handlers attached per tab');
    assert.ok(AUDIO_RS.includes('SetIsMuted'), 'Mute command toggles IsMuted');
    assert.ok(MOD_RS.includes('lens_toggle_tab_mute'), 'Command re-exported');
    assert.ok(LIB_RS.includes('lens_cmds::audio::lens_toggle_tab_mute'), 'Command registered in handler');
  });

  it('store + tab strip + api wire the audio state and mute toggle', () => {
    assert.ok(TABS_STORE.includes('setTabAudible'), 'store exposes setTabAudible');
    assert.ok(TABS_STORE.includes('setTabMuted'), 'store exposes setTabMuted');
    assert.ok(PREVIEW.includes("listen('lens-audio-state'"), 'LensPreview routes the event');
    assert.ok(TAB_BAR.includes('browser-tab-audio'), 'Tab strip renders a speaker icon');
    assert.ok(TAB_BAR.includes('lensToggleTabMute'), 'Speaker click toggles mute');
    assert.ok(API_JS.includes("invoke('lens_toggle_tab_mute'"), 'api wrapper exists');
  });
});

describe('browser tier2: tab reorder (drag)', () => {
  it('store exposes a pure-frontend reorderTab', () => {
    assert.ok(TABS_STORE.includes('reorderTab(draggedId, targetId)'), 'Should expose reorderTab');
    assert.ok(TABS_STORE.includes('tabs.splice(insertIdx, 0, moved)'), 'Should splice the moved tab in');
  });

  it('tab strip is draggable and reorders on drop', () => {
    assert.ok(TAB_BAR.includes('draggable="true"'), 'Tabs should be draggable');
    assert.ok(TAB_BAR.includes('handleDragStart'), 'Should have a dragstart handler');
    assert.ok(TAB_BAR.includes('browserTabsStore.reorderTab(draggedTabId, tabId)'), 'Drop should reorder');
    assert.ok(TAB_BAR.includes('x-vm-browser-tab'), 'Should use an isolated drag type');
  });
});

describe('browser tier2: permission prompts', () => {
  it('Rust handler defers unremembered requests and emits an event', () => {
    assert.ok(WEBVIEW_SETUP.includes('add_PermissionRequested'), 'Should register PermissionRequested');
    assert.ok(WEBVIEW_SETUP.includes('lens-permission-request'), 'Should emit the request event');
    assert.ok(WEBVIEW_SETUP.includes('GetDeferral'), 'Unremembered requests are deferred');
    assert.ok(WEBVIEW_SETUP.includes('permissions::lookup_decision'), 'Remembered decisions applied synchronously');
    assert.ok(WEBVIEW_SETUP.includes('register_permission_handler(&app_for_download'), 'Handler attached per tab');
  });

  it('permissions.rs resolves the deferral on the main thread and persists', () => {
    assert.ok(PERMISSIONS_RS.includes('browser-permissions.json'), 'Should persist decisions');
    assert.ok(PERMISSIONS_RS.includes('run_on_main_thread'), 'Should resolve on the UI thread');
    assert.ok(PERMISSIONS_RS.includes('deferral.Complete()'), 'Should complete the deferral');
    assert.ok(PERMISSIONS_RS.includes('thread_local'), 'Pending requests kept on the UI thread');
    assert.ok(LIB_RS.includes('lens_cmds::permissions::lens_permission_response'), 'Command registered');
  });

  it('LensWorkspace shows an Allow/Block bar under the toolbar', () => {
    assert.ok(WORKSPACE.includes("listen('lens-permission-request'"), 'Should route the event');
    assert.ok(WORKSPACE.includes('permission-bar'), 'Should render the prompt bar');
    assert.ok(WORKSPACE.includes('answerPermission(true)'), 'Allow answers the prompt');
    assert.ok(WORKSPACE.includes('answerPermission(false)'), 'Block answers the prompt');
    assert.ok(WORKSPACE.includes('lensPermissionResponse'), 'Answer calls the response command');
  });
});
