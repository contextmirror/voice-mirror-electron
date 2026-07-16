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

- [ ] **Omnibox** — address-bar suggestion dropdown fed by history + bookmarks
      (+ optional search suggestions).
- [ ] **Security indicator** — padlock/warning chip in the address bar;
      interstitial via `ServerCertificateErrorDetected`.
- [ ] **Permission prompts** — `PermissionRequested` (currently untouched →
      WebView2 defaults); VM-styled prompt + per-site remembered decisions.
- [ ] **HTML5 fullscreen** — `ContainsFullScreenElementChanged` (videos can't
      properly fullscreen today).
- [ ] **Print** — `ShowPrintUI` on Ctrl+P.
- [ ] **Find match counts** — upgrade `window.find()` loop or adopt the
      ICoreWebView2Find API.
- [ ] **Tab audio** — playing indicator + mute toggle
      (`IsDocumentPlayingAudio`/`IsMuted`, ICoreWebView2_8).
- [ ] **Tab reorder (drag)** in `BrowserTabBar`.
- [ ] **Per-nav progress bar** (`ContentLoading`/`NavigationCompleted`).

## Tier 3 — differentiators

- [ ] **Extensions manager** — the marquee. Steps:
      1. `browserExtensionsEnabled: true` on the main window config (env-wide
         flag; one-time decision, needs app restart).
      2. Rust commands over `ICoreWebView2Profile7`: add (unpacked folder),
         list, enable/disable, remove.
      3. Extensions page in Settings; extension buttons in the browser toolbar
         (WebView2 renders NO extension UI — we open
         `chrome-extension://<id>/<popup>.html` ourselves, path from each
         manifest's `action.default_popup`).
      4. "Install from Chrome Web Store URL": download CRX, strip header
         (CRX3 = zip + header), unpack to a managed extensions dir. Updates =
         re-download. NOTE: source folder must stay untouched or WebView2
         drops the extension.
      5. Blessed one-click installs: uBlock Origin (works headless),
         React DevTools / Vue DevTools (framework debugging inside App
         Preview — direct boost to the voice→build→see→fix loop).
- [ ] **Per-project browser profiles** — named WebView2 profiles give each
      project isolated cookies/sessions (client A's logins never bleed into
      client B's). Very VM-native.
- [ ] **Private tabs** — tauri `incognito` webview option (InPrivate profile).
- [ ] **Privacy toggles** — tracking-prevention level, password autosave,
      general autofill (profile settings, currently defaults).
- [ ] **Basic-auth dialog** — `BasicAuthenticationRequested`.

## Out of scope (platform limits)

- Chrome Web Store live sync/auto-update (we re-download instead).
- PWA installs (unsupported by WebView2).
- Extension toolbar popups rendered by WebView2 (we render our own).

## Gotchas that will bite

- `AreBrowserExtensionsEnabled` is an ENVIRONMENT flag: every webview shares
  it; mismatched values against a running env fail with ERROR_INVALID_STATE.
  Set it once via the main window's `browserExtensionsEnabled` in
  tauri.conf.json.
- Config schema drops undeclared fields (see `ProjectEntry` in
  `config/schema.rs`) — every new persisted pref needs its schema field IN THE
  SAME CHANGE.
- `tauri dev` watches `src-tauri/` — batch Rust edits in a worktree; merge once.
