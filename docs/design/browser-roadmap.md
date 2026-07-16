# In-app browser roadmap — "a proper browser"

Status: living document. Started 2026-07-16 from a full code inventory of the
lens browser plus verification of WebView2/wry/tauri extension support.

## Where we stand

Each browser tab is a real native child WebView2 (`window.add_child`), not an
iframe. Already solid: tabs (cap 8), smart address bar (URL vs search), embedded
CDP DevTools (port 9222), find-in-page (`find.rs` + `FindBar`), persisted
history (`browser-history.json`, cap 1000), download tracking with the native
Save-As dialog, OAuth popup→tab handling (`NewWindowRequested`), per-tab zoom,
Chrome desktop UA.

Verified versions: tauri 2.11.1, wry 0.55.1, webview2-com 0.38.2 — all three
carry what extensions need (`browser_extensions_enabled` env flag,
`ICoreWebView2Profile7::AddBrowserExtension`).

## Tier 1 — table stakes (SHIPPED 2026-07-16, branch worktree-browser-tier1)

- [x] **Tab favicons + loading spinners** — `FaviconChanged` (ICoreWebView2_15)
      → `lens-favicon-changed {tabId, faviconUri}`; spinner in a fixed icon
      slot (globe fallback). (`BrowserTabBar.svelte`, `webview_setup.rs`)
- [x] **Native back/forward with real states** — `GoBack`/`GoForward` via COM
      + `HistoryChanged` → per-tab `canGoBack`/`canGoForward`; toolbar buttons
      disable. (`navigation.rs`, `LensToolbar.svelte`)
- [x] **Browser session restore** — open tabs + active index persist in
      workspace-state (`browserSession`); restored when the browser pane first
      opens. Note: applies at app startup; switching projects mid-session
      still carries tabs over (deliberate, revisit in Tier 2).
- [x] **Bookmarks** — `browser-bookmarks.json` (`bookmarks.rs`), star in the
      address bar, `BookmarksPanel`, Bookmarks entry in the browser menu.
- [x] **Download config + persistence** — `downloadAskLocation`/`downloadPath`
      now honored in `DownloadStarting` (ask → Save-As dialog; otherwise
      silent to configured folder with "(n)" collision suffixes, Chrome-like);
      finished downloads persist to `browser-downloads.json` and seed the
      panel on startup.

## Tier 2 — the "feels like Chrome" layer

- [x] **Omnibox** — address-bar suggestion dropdown fed by history + bookmarks,
      filtered as you type, up/down/enter/escape keyboard nav. Bindable
      `suggestionsOpen` folds into LensWorkspace's freeze() (airspace).
      (`LensToolbar.svelte`, `LensWorkspace.svelte`)
- [x] **Security indicator** — padlock (https) / warning (http) / error chip at
      the LEFT of the address bar, derived from the active tab URL + cert-error
      flag. `ServerCertificateErrorDetected` (ICoreWebView2_14) emits
      `lens-cert-error` → chip goes red. NOTE: the custom DOM interstitial was
      SKIPPED — leaving the WebView2 default action renders its own built-in
      cert interstitial (with proceed-anyway) in the tab; a custom overlay would
      need freeze airspace + deferral/proceed plumbing that duplicates it.
      (`LensToolbar.svelte`, `webview_setup.rs`)
- [x] **Permission prompts** — `PermissionRequested` handled: remembered
      decisions apply synchronously; unremembered ones take a deferral (stashed
      in a UI-thread `thread_local`), emit `lens-permission-request`, and a
      VM-styled Allow/Block bar under the toolbar answers via
      `lens_permission_response` (resolves the deferral on the main thread +
      persists to `browser-permissions.json`). Gap: no UI yet to review/reset
      remembered decisions (edit the JSON). (`permissions.rs`,
      `webview_setup.rs`, `LensWorkspace.svelte`)
- [x] **HTML5 fullscreen** — `ContainsFullScreenElementChanged` (base
      ICoreWebView2) → `lens-fullscreen-changed {tabId, fullscreen}`; the active
      webview fills the whole window while fullscreen (`syncBounds` honors it)
      and restores the pane bounds on exit. (`webview_setup.rs`,
      `LensPreview.svelte`)
- [x] **Print** — Ctrl+P in the child webview shortcut script → `lens-shortcut`
      'print' → `lens_print` calls `ICoreWebView2_16::ShowPrintUI` (browser print
      preview). (`webview_setup.rs`, `navigation.rs`, `App.svelte`)
- [x] **Find match counts** — `find.rs` now returns `{found, total}`; total is a
      JS-side case-insensitive scan of the page's rendered `innerText` (the
      accepted approach). `FindBar` shows `current/total` (or "No results"),
      tracking the active match forward/back with wraparound. (`find.rs`,
      `FindBar.svelte`)
- [x] **Tab audio** — playing indicator + click-to-mute in the tab strip.
      `IsDocumentPlayingAudioChanged`/`IsMutedChanged` (ICoreWebView2_8) emit
      `lens-audio-state`; `lens_toggle_tab_mute` flips `SetIsMuted`.
      (`audio.rs`, `webview_setup.rs`, `BrowserTabBar.svelte`)
- [x] **Tab reorder (drag)** — HTML5 drag-to-reorder in `BrowserTabBar` (pure
      frontend array move via `browserTabsStore.reorderTab`; isolated
      `x-vm-browser-tab` drag type so it never collides with editor-tab DnD).
- [x] **Per-nav progress bar** — thin indeterminate accent bar under the toolbar
      while the active tab loads. Per-tab `loading` is now driven by Tauri
      `on_page_load` Started/Finished → `lens-loading-changed` (previously the
      flag was never set true, so the tab spinner was dead too — this fixes
      both). (`webview_setup.rs`, `LensPreview.svelte`, `LensWorkspace.svelte`)

## Tier 3 — differentiators (SHIPPED 2026-07-17, branch worktree-browser-tier3)

- [x] **Extensions manager** — the marquee. Shipped:
      1. `browserExtensionsEnabled: true` on the main window
         (`tauri.conf.json`; env-wide, needs an app restart the first time —
         `tauri.nightly.conf.json` only overrides updater endpoints, so no
         mirror needed there).
      2. Rust commands over `ICoreWebView2Profile7` (reached via
         `ICoreWebView2_13::Profile()`) in `commands/lens/extensions.rs`:
         `lens_extensions_list` / `_add` / `_install_crx` / `_set_enabled` /
         `_remove`. Async completion handlers use the mpsc + `recv_timeout`
         pattern (see `report_page_title`).
      3. `ExtensionsSettings.svelte` (new Settings tab) lists installed
         extensions with enable/disable + remove; the toolbar renders a
         letter-badge button per enabled extension that declares a popup and
         opens `chrome-extension://<id>/<popup>` in a new tab (WebView2 renders
         no extension UI). A shared `browser-extensions.svelte.js` store keeps
         the two in sync (`lens-extensions-changed` window event).
      4. CRX install: locate the first `PK\x03\x04` zip signature and unzip
         from there (works for CRX2/CRX3 without parsing headers), into a
         managed dir `get_data_dir()/extensions/<slug>/` that is NEVER mutated
         after install. `index.json` maps the WebView2 id → parsed popup path.
         URLs downloaded with reqwest. `zip` was made a non-optional dep (was
         gated behind the `onnx` feature).
      5. Blessed one-click installs: uBlock Origin + React DevTools via the
         Chrome Web Store CRX endpoint.
      NOTE: every command needs an open browser tab (the profile is reached
      through a tab's webview); the UI shows a "restart / open a tab" notice
      instead of a hard error when it isn't reachable yet. Manifest names are
      i18n-resolved (`__MSG_…__` → `_locales/<default_locale>/messages.json`).
- [x] **Private tabs** — `WebviewBuilder::incognito(true)` (tauri 2.11.1
      exposes it; wry 0.55 `with_incognito`). Threaded through
      `lens_create_tab` (`incognito: Option<bool>`) → `create_tab_webview`;
      "New Private Tab" in the tab-bar context menu, tinted tab + mask icon,
      title "Private Tab". Extensions don't load in InPrivate (expected).
- [x] **Privacy toggles** — tracking-prevention level
      (`ICoreWebView2Profile3::SetPreferredTrackingPreventionLevel`), password
      autosave + general autofill (`ICoreWebView2Profile6`). `lens_apply_privacy`
      + a Privacy section in `ExtensionsSettings`; persisted in
      `BrowserConfig` (`trackingPrevention` / `passwordAutosave` /
      `generalAutofill`, schema + frontend defaults) and re-applied at
      tab-creation time. Defaults match WebView2's (balanced / off / on).
- [ ] **Per-project browser profiles** — NOT blocked as originally guessed:
      `WebviewBuilder::data_directory(PathBuf)` IS public in tauri 2.11.1, so a
      distinct user-data folder per project would give isolated cookies/
      sessions (a separate WebView2 environment per data dir). DEFERRED, not
      shipped: it's a larger tab-lifecycle change (project switch must recreate
      tabs under the project's data dir; session-restore + the shared
      extensions env interact with it) and belongs with the tab-lifecycle
      owner, not a best-effort pass. The mechanism is confirmed feasible.
- [ ] **Basic-auth dialog** — SKIPPED (best-effort, low marginal value).
      `ICoreWebView2_10::add_BasicAuthenticationRequested` +
      `BasicAuthenticationRequestedEventHandler` exist in webview2-com 0.38.2,
      so a custom VM-styled prompt bar (mirroring the Tier 2 permission bar with
      a deferral) is feasible. But WebView2 already shows a native basic-auth
      dialog by default, so a custom one is cosmetic parity — deferred to keep
      scope on the marquee and avoid extra prompt-bar surface.

## Out of scope (platform limits)

- Chrome Web Store live sync/auto-update (we re-download instead).
- PWA installs (unsupported by WebView2).
- Extension toolbar popups rendered by WebView2 (we render our own).

## Gotchas that will bite

- `AreBrowserExtensionsEnabled` is an ENVIRONMENT flag: every webview shares
  it; mismatched values against a running env fail with ERROR_INVALID_STATE.
  Setting it ONLY on the main window (`browserExtensionsEnabled` in
  tauri.conf.json) is NOT enough — that was a live regression (2026-07-17,
  `0x8007139F` on `add_child`). wry creates one WebView2 environment per
  webview, but they all share the default user-data folder, and WebView2
  rejects a second environment on that folder with different options. So EVERY
  programmatically-built child webview must ALSO call
  `.browser_extensions_enabled(true)`: the lens-tab / device-preview builder
  (`webview_setup.rs::create_tab_webview`) and the DevTools-panel builder
  (`devtools.rs`). The App Preview sandbox is an iframe in the main window, so
  it's already covered. Isolating lens to its own `data_directory` instead is
  NOT an option — a separate user-data folder = a separate browser process that
  can't bind the shared `--remote-debugging-port=9222`, which would break
  embedded DevTools.
- Config schema drops undeclared fields (see `ProjectEntry` in
  `config/schema.rs`) — every new persisted pref needs its schema field IN THE
  SAME CHANGE.
- `tauri dev` watches `src-tauri/` — batch Rust edits in a worktree; merge once.
