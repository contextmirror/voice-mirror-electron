/**
 * browser-tier3.test.cjs -- Source-inspection tests for the Tier 3
 * differentiators: the browser extensions manager (marquee) plus the
 * best-effort items that shipped (private tabs, privacy toggles, basic-auth).
 * See docs/design/browser-roadmap.md.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf-8');
const exists = (...p) => fs.existsSync(path.join(__dirname, '..', '..', ...p));

const EXT_RS = read('src-tauri', 'src', 'commands', 'lens', 'extensions.rs');
const MOD_RS = read('src-tauri', 'src', 'commands', 'lens', 'mod.rs');
const LIB_RS = read('src-tauri', 'src', 'lib.rs');
const API_JS = read('src', 'lib', 'api.js');
const CARGO = read('src-tauri', 'Cargo.toml');
const TAURI_CONF = read('src-tauri', 'tauri.conf.json');
const EXT_STORE = read('src', 'lib', 'stores', 'browser-extensions.svelte.js');
const EXT_SETTINGS = read('src', 'components', 'settings', 'ExtensionsSettings.svelte');
const SETTINGS_PANEL = read('src', 'components', 'settings', 'SettingsPanel.svelte');
const TOOLBAR = read('src', 'components', 'lens', 'LensToolbar.svelte');
const WEBVIEW_SETUP = read('src-tauri', 'src', 'commands', 'lens', 'webview_setup.rs');
const SCHEMA_RS = read('src-tauri', 'src', 'config', 'schema.rs');
const CONFIG_JS = read('src', 'lib', 'stores', 'config.svelte.js');
const PRIVACY_RS = read('src-tauri', 'src', 'commands', 'lens', 'privacy.rs');
const TABS_RS = read('src-tauri', 'src', 'commands', 'lens', 'tabs.rs');
const TABS_STORE = read('src', 'lib', 'stores', 'browser-tabs.svelte.js');
const TAB_BAR = read('src', 'components', 'lens', 'browser', 'BrowserTabBar.svelte');

describe('browser tier3: extensions env flag', () => {
  it('enables browserExtensionsEnabled on the main window', () => {
    assert.ok(TAURI_CONF.includes('"browserExtensionsEnabled": true'), 'main window opts in');
  });

  it('zip is a non-optional dependency (CRX unpacking always available)', () => {
    // The extensions CRX path unzips regardless of the native-ml/onnx feature.
    assert.ok(/zip = \{ version = "2"[^}]*\}/.test(CARGO), 'declares zip 2');
    assert.ok(!/zip = \{[^}]*optional = true/.test(CARGO), 'zip must not be optional');
    assert.ok(!/onnx = \[[^\]]*"zip"/.test(CARGO), 'zip dropped from the onnx feature list');
  });
});

describe('browser tier3: extension COM commands', () => {
  it('reaches the profile via ICoreWebView2_13 → ICoreWebView2Profile7', () => {
    assert.ok(EXT_RS.includes('ICoreWebView2_13'), 'casts to _13 for Profile()');
    assert.ok(EXT_RS.includes('ICoreWebView2Profile7'), 'casts profile to Profile7');
    assert.ok(EXT_RS.includes('.Profile()'), 'gets the profile');
  });

  it('implements list / add / enable / remove over the WebView2 APIs', () => {
    assert.ok(EXT_RS.includes('GetBrowserExtensions'), 'list uses GetBrowserExtensions');
    assert.ok(EXT_RS.includes('AddBrowserExtension'), 'add uses AddBrowserExtension');
    assert.ok(EXT_RS.includes('.Enable('), 'enable/disable toggles Enable');
    assert.ok(EXT_RS.includes('.Remove('), 'remove uses Remove');
  });

  it('uses the mpsc + recv_timeout completion-handler pattern', () => {
    assert.ok(EXT_RS.includes('ProfileGetBrowserExtensionsCompletedHandler'), 'get handler');
    assert.ok(EXT_RS.includes('ProfileAddBrowserExtensionCompletedHandler'), 'add handler');
    assert.ok(EXT_RS.includes('recv_timeout'), 'blocks for the async completion');
    assert.ok(EXT_RS.includes('with_webview'), 'runs COM on the webview thread');
  });

  it('copies extensions into a managed dir that is never mutated after install', () => {
    assert.ok(EXT_RS.includes('get_data_dir()'), 'managed under the data dir');
    assert.ok(EXT_RS.includes('fn extensions_dir'), 'has a managed extensions dir');
    assert.ok(EXT_RS.includes('fn copy_dir_all'), 'copies the source in');
    assert.ok(EXT_RS.includes('index.json'), 'persists an id↔popup index');
  });

  it('parses CRX3 by finding the PK zip signature and unzipping from there', () => {
    assert.ok(EXT_RS.includes('fn find_zip_offset'), 'locates the zip payload');
    assert.ok(EXT_RS.includes('0x50, 0x4B, 0x03, 0x04'), 'matches the PK\\x03\\x04 magic');
    assert.ok(EXT_RS.includes('zip::ZipArchive'), 'unzips the payload');
    assert.ok(EXT_RS.includes('enclosed_name'), 'guards against path traversal');
  });

  it('downloads a CRX URL with reqwest (blessed one-click installs)', () => {
    assert.ok(EXT_RS.includes('reqwest::Client'), 'downloads over HTTP');
    assert.ok(/pub async fn lens_extension_install_crx/.test(EXT_RS), 'install_crx is async');
  });

  it('resolves __MSG_ i18n names and reads the popup path from the manifest', () => {
    assert.ok(EXT_RS.includes('fn resolve_i18n'), 'resolves i18n placeholders');
    assert.ok(EXT_RS.includes('default_popup'), 'reads the browser-action popup');
    assert.ok(EXT_RS.includes('browser_action'), 'supports MV2 popups too');
  });
});

describe('browser tier3: command registration + api', () => {
  it('re-exports and registers all five commands', () => {
    for (const cmd of [
      'lens_extensions_list',
      'lens_extension_add',
      'lens_extension_install_crx',
      'lens_extension_set_enabled',
      'lens_extension_remove',
    ]) {
      assert.ok(MOD_RS.includes(cmd), `mod re-exports ${cmd}`);
      assert.ok(LIB_RS.includes(`lens_cmds::extensions::${cmd}`), `lib registers ${cmd}`);
    }
  });

  it('exposes api.js wrappers', () => {
    assert.ok(API_JS.includes("invoke('lens_extensions_list'"), 'list wrapper');
    assert.ok(API_JS.includes("invoke('lens_extension_add'"), 'add wrapper');
    assert.ok(API_JS.includes("invoke('lens_extension_install_crx'"), 'crx wrapper');
    assert.ok(API_JS.includes("invoke('lens_extension_set_enabled'"), 'enable wrapper');
    assert.ok(API_JS.includes("invoke('lens_extension_remove'"), 'remove wrapper');
    assert.ok(API_JS.includes('// ============ Browser Extensions'), 'has a section header');
  });
});

describe('browser tier3: extensions UI', () => {
  it('ships an ExtensionsSettings section wired into SettingsPanel', () => {
    assert.ok(exists('src', 'components', 'settings', 'ExtensionsSettings.svelte'), 'component exists');
    assert.ok(SETTINGS_PANEL.includes('ExtensionsSettings'), 'imported into the panel');
    assert.ok(SETTINGS_PANEL.includes("id: 'extensions'"), 'registered as a tab');
  });

  it('lists extensions with enable/disable + remove and a folder installer', () => {
    assert.ok(EXT_SETTINGS.includes('lensExtensionSetEnabled'), 'enable/disable toggle');
    assert.ok(EXT_SETTINGS.includes('lensExtensionRemove'), 'remove action');
    assert.ok(EXT_SETTINGS.includes('lensExtensionAdd'), 'install from folder');
    assert.ok(EXT_SETTINGS.includes("directory: true"), 'uses the folder picker');
  });

  it('offers blessed one-click installs via the Chrome Web Store CRX endpoint', () => {
    assert.ok(EXT_SETTINGS.includes('cjpalhdlnbpafiamejdnhcphjbkeiagm'), 'uBlock Origin id');
    assert.ok(EXT_SETTINGS.includes('fmkadmapgofadopljbjfkapdkoienihi'), 'React DevTools id');
    assert.ok(EXT_SETTINGS.includes('lensExtensionInstallCrx'), 'installs via CRX');
    assert.ok(EXT_SETTINGS.includes('clients2.google.com'), 'uses the CRX endpoint');
  });

  it('surfaces a restart-needed notice instead of a hard error', () => {
    assert.ok(/restart|not supported/i.test(EXT_SETTINGS), 'detects the restart/unsupported case');
    assert.ok(EXT_SETTINGS.includes('ext-notice'), 'renders a notice banner');
  });

  it('toolbar renders popup buttons from the shared store', () => {
    assert.ok(exists('src', 'lib', 'stores', 'browser-extensions.svelte.js'), 'store exists');
    assert.ok(EXT_STORE.includes('get withPopup'), 'store exposes popup-capable extensions');
    assert.ok(TOOLBAR.includes('browserExtensionsStore.withPopup'), 'toolbar iterates them');
    assert.ok(TOOLBAR.includes('chrome-extension://'), 'opens the popup URL');
    assert.ok(TOOLBAR.includes('openTab'), 'opens the popup in a new tab');
  });

  it('keeps the toolbar in sync with settings mutations', () => {
    assert.ok(EXT_SETTINGS.includes("lens-extensions-changed"), 'settings dispatches a change event');
    assert.ok(TOOLBAR.includes("lens-extensions-changed"), 'toolbar refreshes on it');
  });
});

describe('browser tier3: privacy toggles (best-effort)', () => {
  it('applies tracking prevention + autosave + autofill on the profile', () => {
    assert.ok(PRIVACY_RS.includes('SetPreferredTrackingPreventionLevel'), 'tracking prevention');
    assert.ok(PRIVACY_RS.includes('SetIsPasswordAutosaveEnabled'), 'password autosave');
    assert.ok(PRIVACY_RS.includes('SetIsGeneralAutofillEnabled'), 'general autofill');
    assert.ok(LIB_RS.includes('lens_cmds::privacy::lens_apply_privacy'), 'command registered');
    assert.ok(API_JS.includes("invoke('lens_apply_privacy'"), 'api wrapper');
  });

  it('persists the new prefs in the config schema (both sides)', () => {
    assert.ok(SCHEMA_RS.includes('tracking_prevention'), 'schema has tracking field');
    assert.ok(SCHEMA_RS.includes('password_autosave'), 'schema has autosave field');
    assert.ok(SCHEMA_RS.includes('general_autofill'), 'schema has autofill field');
    assert.ok(CONFIG_JS.includes('trackingPrevention'), 'frontend default mirrors it');
  });

  it('applies privacy at tab-creation time', () => {
    assert.ok(WEBVIEW_SETUP.includes('apply_privacy_to_webview'), 'applied on new webviews');
  });

  it('exposes the toggles in the settings UI', () => {
    assert.ok(EXT_SETTINGS.includes('Tracking prevention'), 'tracking dropdown');
    assert.ok(EXT_SETTINGS.includes('lensApplyPrivacy'), 'save applies to the profile');
  });
});

describe('browser tier3: private tabs (best-effort)', () => {
  it('threads incognito through the webview builder', () => {
    assert.ok(WEBVIEW_SETUP.includes('.incognito(incognito)'), 'builder opts into incognito');
    assert.ok(/incognito: bool/.test(WEBVIEW_SETUP), 'create_tab_webview takes the flag');
    assert.ok(/incognito: Option<bool>/.test(TABS_RS), 'command accepts an optional flag');
  });

  it('store + api + tab object carry the incognito flag', () => {
    assert.ok(TABS_STORE.includes('incognito'), 'store tracks incognito');
    assert.ok(API_JS.includes('incognito'), 'api wrapper passes it');
  });

  it('tab bar offers a New Private Tab action with a visual tint', () => {
    assert.ok(TAB_BAR.includes('New Private Tab'), 'context-menu entry');
    assert.ok(TAB_BAR.includes('onNewPrivateTab'), 'wired to a callback');
    assert.ok(TAB_BAR.includes('browser-tab.incognito'), 'incognito tab is tinted');
  });
});
