//! WebView2 creation and initialization internals.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Position, Size, LogicalPosition, LogicalSize, WebviewBuilder};
use tracing::{info, warn};
use super::DownloadEntry;

static DOWNLOAD_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Maximum number of browser tabs allowed.
pub(super) const MAX_TABS: usize = 8;

/// Build the shortcut interception script for child WebView2 instances.
/// Child WebView2 instances are separate processes (NOT iframes), so
/// window.top.postMessage() doesn't reach the parent. Instead we fire a
/// request to a custom Tauri URI scheme (`lens-shortcut://`) which is handled
/// in lib.rs and re-emitted as a Tauri event the frontend can listen to.
pub(super) fn build_shortcut_script() -> String {
    let shortcut_base = if cfg!(target_os = "windows") {
        "https://lens-shortcut.localhost/"
    } else {
        "lens-shortcut://localhost/"
    };
    format!(
        r#"document.addEventListener('keydown', function(e) {{
            var key = e.key;
            var lower = key.toLowerCase();
            if (key === 'F1') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'F1' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && lower === 'r') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'hard-refresh' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && ['n','t',','].includes(lower)) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + lower + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && lower === 'f') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'find' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && lower === 'p') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'print' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && (key === '+' || key === '=')) {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-in' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '-') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-out' + '?t=' + Date.now();
                }} catch(err) {{}}
            }} else if ((e.ctrlKey || e.metaKey) && key === '0') {{
                e.preventDefault();
                e.stopPropagation();
                try {{
                    (new Image()).src = '{}' + 'zoom-reset' + '?t=' + Date.now();
                }} catch(err) {{}}
            }}
        }}, true);"#,
        shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base, shortcut_base
    )
}

/// Evaluate `document.title` in a child webview via the native WebView2 COM API
/// and emit a `lens-title-changed` Tauri event with the result.
///
/// This must be done via COM because:
/// 1. Tauri's `webview.eval()` is fire-and-forget (no return value)
/// 2. Custom URI schemes (`register_uri_scheme_protocol`) don't intercept
///    requests from child webviews — only the main app webview
///
/// Uses `std::thread::spawn` because `on_page_load` runs on the main Win32 GUI
/// thread which has no tokio runtime context.
fn report_page_title(app: &AppHandle, webview: &tauri::Webview, tab_id: String) {
    let app = app.clone();
    let webview = webview.clone();

    std::thread::spawn(move || {
        // Brief delay to let the page title settle (some pages set title via JS after load)
        std::thread::sleep(std::time::Duration::from_millis(150));

        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

        let eval_result = webview.with_webview(move |platform_webview| {
            #[cfg(windows)]
            {
                use webview2_com::ExecuteScriptCompletedHandler;
                use windows_core::HSTRING;

                unsafe {
                    let controller = platform_webview.controller();
                    let core_webview = match controller.CoreWebView2() {
                        Ok(wv) => wv,
                        Err(_) => {
                            let _ = tx.send(None);
                            return;
                        }
                    };

                    let js = HSTRING::from("document.title");
                    let handler =
                        ExecuteScriptCompletedHandler::create(Box::new(move |hresult, result| {
                            if hresult.is_ok() {
                                // ExecuteScript returns JSON-serialized string, e.g. "\"Google\""
                                let title = result.trim_matches('"').to_string();
                                if !title.is_empty() && title != "null" {
                                    let _ = tx.send(Some(title));
                                } else {
                                    let _ = tx.send(None);
                                }
                            } else {
                                let _ = tx.send(None);
                            }
                            Ok(())
                        }));

                    if let Err(_) = core_webview.ExecuteScript(&js, &handler) {
                        // handler was moved, tx is gone — nothing to do
                    }
                }

                #[cfg(not(windows))]
                {
                    let _ = tx.send(None);
                }
            }
        });

        if eval_result.is_err() {
            return;
        }

        // Wait up to 2s for the COM callback
        let title = match rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(Some(t)) => t,
            _ => return,
        };
        info!("[lens] Page title (tab {}): {}", tab_id, title);
        let _ = app.emit(
            "lens-title-changed",
            serde_json::json!({ "tabId": tab_id, "title": title }),
        );
    });
}

/// Localhost-only dev-mode cache-busting script.
/// 1. Unregisters all service workers (they intercept Vite HMR and cause stale/blank pages).
/// 2. Overrides fetch() and XMLHttpRequest to bypass HTTP cache for dev servers.
/// Only activates when the page hostname is localhost or 127.0.0.1.
pub(super) const CACHE_SCRIPT: &str = r#"
(function() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
                regs.forEach(function(reg) { reg.unregister(); });
            });
        }
        var originalFetch = window.fetch;
        window.fetch = function(url, opts) {
            opts = opts || {};
            opts.cache = 'no-store';
            return originalFetch.call(this, url, opts);
        };
        var originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
            var result = originalOpen.apply(this, arguments);
            try { this.setRequestHeader('Cache-Control', 'no-cache, no-store'); } catch(e) {}
            return result;
        };
    }
})();
"#;

/// Crash-guard initialization script for child WebView2 instances.
///
/// wry's `window.ipc.postMessage` handler (webview2/mod.rs:905) unconditionally
/// parses the page's origin URL as an `http::Uri` and `.unwrap()`s the result:
///   `ipc_handler(Request::builder().uri(url).body(js).unwrap())`
/// For non-http(s) origins (`file://`, `data:`, `about:`) that parse fails with
/// `InvalidUri(InvalidFormat)`, panicking inside a non-unwinding FFI callback,
/// which aborts the entire app (STATUS_STACK_BUFFER_OVERRUN). This is what made
/// Voice Mirror crash when a locally-edited `file://` HTML page was reloaded and
/// something on it touched the wry IPC channel.
///
/// Lens browser tabs never use the wry IPC channel — host<->child comms go
/// through custom URI schemes (`new Image().src`) and `ExecuteScript`. So we
/// neutralise `window.chrome.webview.postMessage` (the function wry's
/// `window.ipc.postMessage` forwards to) on **every** origin a Lens tab can load.
///
/// This must include http/https: a Tauri app's dev server (e.g. Blip on
/// `http://localhost:1430`) ships a frontend that calls `invoke()`/`listen()`
/// on mount, which drives the same wry IPC channel and aborts the host the same
/// way `file://` did. An earlier version of this guard early-returned on
/// http/https and left that case unprotected — editing Blip in Lens (HMR
/// re-mounting a component that calls `invoke`) crashed the whole app.
///
/// No legitimate browsed page uses `window.chrome.webview.postMessage`; only a
/// WebView2/Tauri frontend embedded in a host it doesn't own does. Neutralising
/// it is therefore safe for normal browsing and makes such a frontend degrade
/// gracefully (its IPC calls no-op) instead of taking down Voice Mirror.
pub(super) const IPC_CRASH_GUARD_SCRIPT: &str = r#"
(function() {
    try {
        var wv = window.chrome && window.chrome.webview;
        if (!wv || typeof wv.postMessage !== 'function') return;
        var noop = function() {};
        try {
            Object.defineProperty(wv, 'postMessage', { value: noop, writable: true, configurable: true });
        } catch (e) {
            try { wv.postMessage = noop; } catch (e2) {}
        }
    } catch (e) {}
})();
"#;

/// ORIGIN-SCOPED variant of the guard above, for the MAIN webview and every
/// frame inside it. Registered as a plugin `js_init_script` in lib.rs, which
/// reaches every webview — and, because Windows/WebView2 injects init scripts
/// into ALL subframes regardless of `for_main_frame_only` (wry 0.55.1
/// webview2/mod.rs ignores the flag), it also reaches every IFRAME.
///
/// Why: the App Preview embeds a web app's dev-server URL in an iframe
/// (SandboxPreview.svelte). That cross-origin frame ALSO receives Tauri's IPC
/// bootstrap (same all-subframes behavior), wiring a live bridge from the
/// embedded app into the host's wry handler. When a frame with a non-http(s)
/// origin posts to it — VS Code web's nested about:srcdoc/blob:/opaque frames
/// do — wry's `Request::builder().uri(url).unwrap()` (webview2/mod.rs:910)
/// panics inside an `extern "system"` COM callback: on Windows that's a
/// `__fastfail` abort — no unwind, no panic hook, no SEH handler, no dump
/// (live repro 2026-07-04: embedding `code serve-web` killed VM with zero
/// crash-log traces).
///
/// Unlike the child-webview guard (which neutralises IPC on EVERY origin —
/// Lens tabs never use it), this one must LEAVE Voice Mirror's own frontend
/// alone or the whole app's invoke()/listen() dies. So it early-returns on
/// VM's own origins (the vite dev origin + the packaged-app origins) and
/// neutralises the transport everywhere else. Both entry points are stubbed:
/// `chrome.webview.postMessage` (the transport) and the `window.ipc` façade
/// wry's bootstrap may already have defined, so injection order doesn't
/// matter. The embedded app degrades gracefully (its IPC calls no-op).
pub(crate) const MAIN_IFRAME_IPC_GUARD_SCRIPT: &str = r#"
(function() {
    try {
        var o = '';
        try { o = String(location.origin || ''); } catch (e) { o = ''; }
        if (o === 'http://localhost:31420'
            || o === 'tauri://localhost'
            || o === 'https://tauri.localhost'
            || o === 'http://tauri.localhost') return;
        var noop = function() {};
        try {
            var wv = window.chrome && window.chrome.webview;
            if (wv && typeof wv.postMessage === 'function') {
                try {
                    Object.defineProperty(wv, 'postMessage', { value: noop, writable: true, configurable: true });
                } catch (e) {
                    try { wv.postMessage = noop; } catch (e2) {}
                }
            }
        } catch (e) {}
        try {
            if (window.ipc && typeof window.ipc.postMessage === 'function') {
                window.ipc.postMessage = noop;
            }
        } catch (e) {}
    } catch (e) {}
})();
"#;

/// Console hook initialization script for child WebView2 instances.
///
/// Intercepts `console.log/warn/error/info/debug` and sends each call to the
/// `lens-console` custom URI scheme via `new Image().src` (fire-and-forget GET).
/// Rust handles these in `lib.rs` and emits a `lens-console-message` Tauri event
/// that the frontend can route to the appropriate project output channel.
///
/// The original console method is always called so DevTools still work normally.
/// Arguments are serialized: objects → JSON, errors → stack trace, primitives → String.
///
/// URL format (Windows): `https://lens-console.localhost/{level}?m={encoded_message}`
/// URL format (others):  `lens-console://localhost/{level}?m={encoded_message}`
pub(super) const CONSOLE_HOOK_SCRIPT: &str = r#"
(function() {
    if (window.__voiceMirrorConsoleHook) return;
    window.__voiceMirrorConsoleHook = true;
    var base = (navigator.platform && navigator.platform.indexOf('Win') !== -1)
        ? 'https://lens-console.localhost/'
        : 'lens-console://localhost/';
    var methods = ['log','warn','error','info','debug'];
    methods.forEach(function(method) {
        var orig = console[method];
        console[method] = function() {
            try {
                var args = Array.prototype.slice.call(arguments);
                var parts = [];
                for (var i = 0; i < args.length; i++) {
                    var a = args[i];
                    if (a === null) { parts.push('null'); continue; }
                    if (a === undefined) { parts.push('undefined'); continue; }
                    if (a instanceof Error) { parts.push(a.stack || a.toString()); continue; }
                    if (typeof a === 'object') {
                        try { parts.push(JSON.stringify(a, null, 2)); }
                        catch(e) { parts.push(String(a)); }
                        continue;
                    }
                    parts.push(String(a));
                }
                var msg = parts.join(' ');
                if (msg.length > 4000) msg = msg.substring(0, 4000) + '...(truncated)';
                new Image().src = base + method + '?m=' + encodeURIComponent(msg) + '&t=' + Date.now();
            } catch(e) {}
            orig.apply(console, arguments);
        };
    });
})();
"#;

/// Register `WebResourceRequested` filters on a child WebView2 so that
/// `lens-shortcut` and `lens-console` custom URI scheme requests are intercepted
/// at the COM level.  `register_uri_scheme_protocol` on the Tauri Builder only
/// intercepts requests from the **main app webview**, not from child webviews.
///
/// For each matching request we emit the corresponding Tauri event (same logic
/// as lib.rs) and return a 1×1 transparent GIF so the `new Image().src` load
/// succeeds silently.
pub(super) fn register_custom_scheme_handler(app: &AppHandle, webview: &tauri::Webview) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::WebResourceRequestedEventHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::{HSTRING, Interface};

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for scheme handler: {:?}", e);
                        return;
                    }
                };

                // Filter for both custom schemes
                let _ = core_webview.AddWebResourceRequestedFilter(
                    &HSTRING::from("https://lens-shortcut.localhost/*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                );
                let _ = core_webview.AddWebResourceRequestedFilter(
                    &HSTRING::from("https://lens-console.localhost/*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE,
                );

                // Get ICoreWebView2_2 for Environment() access
                let core_wv2: ICoreWebView2_2 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] Failed to cast to ICoreWebView2_2: {:?}", e);
                        return;
                    }
                };
                let env = match core_wv2.Environment() {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("[lens] Failed to get environment: {:?}", e);
                        return;
                    }
                };

                let app_for_events = app_handle.clone();
                let handler = WebResourceRequestedEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        let request = args.Request()?;
                        let mut uri_pwstr = windows_core::PWSTR::null();
                        request.Uri(&mut uri_pwstr)?;
                        let uri = if uri_pwstr.is_null() {
                            String::new()
                        } else {
                            uri_pwstr.to_string().unwrap_or_default()
                        };

                        // Parse the URI — same logic as lib.rs handlers
                        let path = uri
                            .split("localhost")
                            .nth(1)
                            .unwrap_or("")
                            .trim_start_matches('/')
                            .trim_start_matches(':');

                        if uri.contains("lens-shortcut") {
                            let key = path
                                .split('?')
                                .next()
                                .unwrap_or("")
                                .trim_matches('/');

                            if key == "hard-refresh" {
                                let _ = app_for_events.emit("lens-hard-refresh", serde_json::json!({}));
                            } else if key == "url-changed" {
                                let query = path.split('?').nth(1).unwrap_or("");
                                let url_param = query
                                    .split('&')
                                    .find_map(|pair| pair.strip_prefix("url="))
                                    .unwrap_or("");
                                let decoded_url = percent_encoding::percent_decode_str(url_param)
                                    .decode_utf8_lossy()
                                    .to_string();
                                let _ = app_for_events.emit(
                                    "lens-url-changed",
                                    serde_json::json!({ "url": decoded_url }),
                                );
                            } else if key == "element-selected" {
                                let _ = app_for_events.emit("element-selected", serde_json::json!({}));
                            } else if key == "element-deselected" {
                                let _ = app_for_events.emit("element-deselected", serde_json::json!({}));
                            } else if !key.is_empty() {
                                info!("[lens-shortcut] Child webview forwarding: {}", key);
                                let _ = app_for_events.emit("lens-shortcut", serde_json::json!({ "key": key }));
                            }
                        } else if uri.contains("lens-console") {
                            let level_part = path
                                .split('?')
                                .next()
                                .unwrap_or("")
                                .trim_matches('/');
                            let query = path.split('?').nth(1).unwrap_or("");
                            let encoded_msg = query
                                .split('&')
                                .find_map(|pair| pair.strip_prefix("m="))
                                .unwrap_or("");
                            let message = percent_encoding::percent_decode_str(encoded_msg)
                                .decode_utf8_lossy()
                                .to_string();
                            if !message.is_empty() {
                                let log_level = match level_part {
                                    "error" => "ERROR",
                                    "warn" => "WARN",
                                    "debug" => "DEBUG",
                                    "info" => "INFO",
                                    _ => "INFO",
                                };
                                let _ = app_for_events.emit(
                                    "lens-console-message",
                                    serde_json::json!({ "level": log_level, "message": message }),
                                );
                            }
                        }

                        // Return empty 200 response so the Image() load doesn't error
                        let response = env.CreateWebResourceResponse(
                            None,
                            200,
                            &HSTRING::from("OK"),
                            &HSTRING::from("Access-Control-Allow-Origin: *"),
                        )?;
                        args.SetResponse(&response)?;

                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = core_webview.add_WebResourceRequested(&handler, &mut token) {
                    warn!("[lens] Failed to register WebResourceRequested: {:?}", e);
                } else {
                    info!("[lens] Registered custom scheme handler for child webview");
                }
            }
        }
    });
}

/// Register a `NewWindowRequested` handler on a child WebView2 so that
/// `window.open()` popups (e.g. an OAuth "Continue with Google" flow) open as a
/// new Lens browser tab instead of being silently dropped.
///
/// The Lens tab webview is hosted directly inside the main window (it is not a
/// standalone browser window), so WebView2 has no surface to place a popup and
/// drops the request — the originating button appears to do nothing. We
/// intercept the event, mark it handled (so WebView2 doesn't try to open its
/// own window), extract the target URI, and emit a `lens-new-window` Tauri event
/// that the frontend turns into a new tab.
pub(super) fn register_new_window_handler(app: &AppHandle, webview: &tauri::Webview) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{NewWindowRequestedEventHandler, take_pwstr};

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for new-window handler: {:?}", e);
                        return;
                    }
                };

                let app_for_events = app_handle.clone();
                let handler = NewWindowRequestedEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        // Prevent WebView2 from trying to open its own popup window.
                        args.SetHandled(true)?;

                        // Extract the requested URI (owned PWSTR — free via take_pwstr).
                        let mut uri_pwstr = windows_core::PWSTR::null();
                        args.Uri(&mut uri_pwstr)?;
                        let uri = take_pwstr(uri_pwstr);

                        if !uri.is_empty() {
                            info!("[lens] NewWindowRequested -> opening as tab: {}", uri);
                            let _ = app_for_events.emit(
                                "lens-new-window",
                                serde_json::json!({ "uri": uri }),
                            );
                        }

                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = core_webview.add_NewWindowRequested(&handler, &mut token) {
                    warn!("[lens] Failed to register NewWindowRequested handler: {:?}", e);
                } else {
                    info!("[lens] NewWindowRequested handler registered (token={})", token);
                }
            }
        }
    });
}

/// Register FaviconChanged + HistoryChanged handlers on a child webview.
///
/// - `HistoryChanged` → `lens-history-changed {tabId, canGoBack, canGoForward}`
///   so the toolbar's back/forward buttons reflect real navigation state
///   (previously they were `history.back()` evals that never disabled).
/// - `FaviconChanged` (ICoreWebView2_15+) → `lens-favicon-changed {tabId,
///   faviconUri}` so the tab strip can show real site icons. Degrades to
///   no favicons on an old runtime.
pub(super) fn register_navigation_state_handlers(
    app: &AppHandle,
    webview: &tauri::Webview,
    tab_id: &str,
) {
    let app_handle = app.clone();
    let tab_id = tab_id.to_string();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{FaviconChangedEventHandler, HistoryChangedEventHandler, take_pwstr};
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for nav-state handlers: {:?}", e);
                        return;
                    }
                };

                // HistoryChanged → real can-go-back/forward state
                {
                    let app_for_history = app_handle.clone();
                    let tab_for_history = tab_id.clone();
                    let handler = HistoryChangedEventHandler::create(Box::new(
                        move |sender, _args| {
                            if let Some(wv) = sender {
                                let mut can_back = windows_core::BOOL::from(false);
                                let mut can_fwd = windows_core::BOOL::from(false);
                                let _ = wv.CanGoBack(&mut can_back);
                                let _ = wv.CanGoForward(&mut can_fwd);
                                let _ = app_for_history.emit(
                                    "lens-history-changed",
                                    serde_json::json!({
                                        "tabId": tab_for_history,
                                        "canGoBack": can_back.as_bool(),
                                        "canGoForward": can_fwd.as_bool(),
                                    }),
                                );
                            }
                            Ok(())
                        },
                    ));
                    let mut token: i64 = 0;
                    if let Err(e) = core_webview.add_HistoryChanged(&handler, &mut token) {
                        warn!("[lens] Failed to register HistoryChanged handler: {:?}", e);
                    }
                }

                // FaviconChanged → tab favicon (needs ICoreWebView2_15+)
                match core_webview.cast::<ICoreWebView2_15>() {
                    Ok(_) => {
                        let app_for_favicon = app_handle.clone();
                        let tab_for_favicon = tab_id.clone();
                        let handler = FaviconChangedEventHandler::create(Box::new(
                            move |sender, _args| {
                                if let Some(wv) = sender {
                                    if let Ok(wv15) = wv.cast::<ICoreWebView2_15>() {
                                        let mut uri_pwstr = windows_core::PWSTR::null();
                                        if wv15.FaviconUri(&mut uri_pwstr).is_ok() {
                                            let uri = take_pwstr(uri_pwstr);
                                            let _ = app_for_favicon.emit(
                                                "lens-favicon-changed",
                                                serde_json::json!({
                                                    "tabId": tab_for_favicon,
                                                    "faviconUri": uri,
                                                }),
                                            );
                                        }
                                    }
                                }
                                Ok(())
                            },
                        ));
                        // add_FaviconChanged lives on ICoreWebView2_15
                        if let Ok(wv15) = core_webview.cast::<ICoreWebView2_15>() {
                            let mut token: i64 = 0;
                            if let Err(e) = wv15.add_FaviconChanged(&handler, &mut token) {
                                warn!("[lens] Failed to register FaviconChanged handler: {:?}", e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("[lens] ICoreWebView2_15 unavailable — tabs get no favicons: {:?}", e);
                    }
                }
            }
        }
    });
}

/// Register a `ServerCertificateErrorDetected` handler (ICoreWebView2_14+) so a
/// TLS certificate error emits `lens-cert-error {tabId, uri, errorStatus}`.
///
/// The frontend uses this to flip the address-bar security chip to an error
/// state. We deliberately DON'T override the action: leaving it at the WebView2
/// default renders WebView2's own built-in interstitial (which includes the
/// "proceed anyway" affordance). A custom DOM interstitial was skipped — it
/// would need webview-freeze airspace handling plus deferral/proceed plumbing
/// to re-drive the navigation, duplicating a page WebView2 already renders well.
/// Degrades to WebView2 defaults on a runtime older than ICoreWebView2_14.
pub(super) fn register_cert_error_handler(
    app: &AppHandle,
    webview: &tauri::Webview,
    tab_id: &str,
) {
    let app_handle = app.clone();
    let tab_id = tab_id.to_string();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{ServerCertificateErrorDetectedEventHandler, take_pwstr};
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_14;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for cert-error handler: {:?}", e);
                        return;
                    }
                };

                let wv14: ICoreWebView2_14 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] ICoreWebView2_14 unavailable — no cert-error events: {:?}", e);
                        return;
                    }
                };

                let app_for_cert = app_handle.clone();
                let tab_for_cert = tab_id.clone();
                let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(
                    move |_sender, args| {
                        if let Some(args) = args {
                            let mut status = Default::default();
                            let _ = args.ErrorStatus(&mut status);
                            let mut uri_pwstr = windows_core::PWSTR::null();
                            let _ = args.RequestUri(&mut uri_pwstr);
                            let uri = take_pwstr(uri_pwstr);
                            let _ = app_for_cert.emit(
                                "lens-cert-error",
                                serde_json::json!({
                                    "tabId": tab_for_cert,
                                    "uri": uri,
                                    "errorStatus": status.0,
                                }),
                            );
                        }
                        // Leave the action at its default → WebView2's built-in
                        // interstitial (with proceed-anyway) renders in the tab.
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = wv14.add_ServerCertificateErrorDetected(&handler, &mut token) {
                    warn!("[lens] Failed to register ServerCertificateErrorDetected: {:?}", e);
                } else {
                    info!("[lens] Cert-error handler registered (token={})", token);
                }
            }
        }
    });
}

/// Register a `ContainsFullScreenElementChanged` handler (base ICoreWebView2) so
/// a page entering/exiting HTML5 fullscreen (e.g. a `<video>` fullscreen button)
/// emits `lens-fullscreen-changed {tabId, fullscreen}`. The frontend then
/// resizes the child webview to fill the whole window while fullscreen and
/// restores the pane bounds on exit.
pub(super) fn register_fullscreen_handler(
    app: &AppHandle,
    webview: &tauri::Webview,
    tab_id: &str,
) {
    let app_handle = app.clone();
    let tab_id = tab_id.to_string();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::ContainsFullScreenElementChangedEventHandler;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for fullscreen handler: {:?}", e);
                        return;
                    }
                };

                let app_for_fs = app_handle.clone();
                let tab_for_fs = tab_id.clone();
                let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(
                    move |sender, _args| {
                        if let Some(wv) = sender {
                            let mut is_fs = windows_core::BOOL::from(false);
                            let _ = wv.ContainsFullScreenElement(&mut is_fs);
                            let _ = app_for_fs.emit(
                                "lens-fullscreen-changed",
                                serde_json::json!({
                                    "tabId": tab_for_fs,
                                    "fullscreen": is_fs.as_bool(),
                                }),
                            );
                        }
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = core_webview.add_ContainsFullScreenElementChanged(&handler, &mut token) {
                    warn!("[lens] Failed to register ContainsFullScreenElementChanged: {:?}", e);
                }
            }
        }
    });
}

/// Register audio-state handlers (ICoreWebView2_8) so a tab that starts/stops
/// playing audio, or is muted/unmuted, emits `lens-audio-state {tabId, audible?,
/// muted?}`. Drives the speaker icon in the tab strip. Degrades to no audio
/// indicator on a runtime older than ICoreWebView2_8.
pub(super) fn register_audio_handlers(
    app: &AppHandle,
    webview: &tauri::Webview,
    tab_id: &str,
) {
    let app_handle = app.clone();
    let tab_id = tab_id.to_string();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{IsDocumentPlayingAudioChangedEventHandler, IsMutedChangedEventHandler};
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for audio handlers: {:?}", e);
                        return;
                    }
                };

                let wv8: ICoreWebView2_8 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] ICoreWebView2_8 unavailable — no tab audio indicator: {:?}", e);
                        return;
                    }
                };

                // IsDocumentPlayingAudioChanged → audible state
                {
                    let app_for_audio = app_handle.clone();
                    let tab_for_audio = tab_id.clone();
                    let handler = IsDocumentPlayingAudioChangedEventHandler::create(Box::new(
                        move |sender, _args| {
                            if let Some(wv) = sender {
                                if let Ok(wv8) = wv.cast::<ICoreWebView2_8>() {
                                    let mut playing = windows_core::BOOL::from(false);
                                    let _ = wv8.IsDocumentPlayingAudio(&mut playing);
                                    let _ = app_for_audio.emit(
                                        "lens-audio-state",
                                        serde_json::json!({
                                            "tabId": tab_for_audio,
                                            "audible": playing.as_bool(),
                                        }),
                                    );
                                }
                            }
                            Ok(())
                        },
                    ));
                    let mut token: i64 = 0;
                    if let Err(e) = wv8.add_IsDocumentPlayingAudioChanged(&handler, &mut token) {
                        warn!("[lens] Failed to register IsDocumentPlayingAudioChanged: {:?}", e);
                    }
                }

                // IsMutedChanged → muted state
                {
                    let app_for_mute = app_handle.clone();
                    let tab_for_mute = tab_id.clone();
                    let handler = IsMutedChangedEventHandler::create(Box::new(
                        move |sender, _args| {
                            if let Some(wv) = sender {
                                if let Ok(wv8) = wv.cast::<ICoreWebView2_8>() {
                                    let mut muted = windows_core::BOOL::from(false);
                                    let _ = wv8.IsMuted(&mut muted);
                                    let _ = app_for_mute.emit(
                                        "lens-audio-state",
                                        serde_json::json!({
                                            "tabId": tab_for_mute,
                                            "muted": muted.as_bool(),
                                        }),
                                    );
                                }
                            }
                            Ok(())
                        },
                    ));
                    let mut token: i64 = 0;
                    if let Err(e) = wv8.add_IsMutedChanged(&handler, &mut token) {
                        warn!("[lens] Failed to register IsMutedChanged: {:?}", e);
                    }
                }
            }
        }
    });
}

/// Register a `PermissionRequested` handler (base ICoreWebView2) so camera /
/// mic / geolocation / notification prompts run through a VM-styled bar and
/// persist per-site. See `permissions.rs` for the deferral flow. A remembered
/// decision is applied synchronously (no prompt); an unremembered one is
/// deferred and surfaced via `lens-permission-request`.
pub(super) fn register_permission_handler(
    app: &AppHandle,
    webview: &tauri::Webview,
    tab_id: &str,
) {
    let app_handle = app.clone();
    let tab_id = tab_id.to_string();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{PermissionRequestedEventHandler, take_pwstr};
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
            };
            use super::permissions;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for permission handler: {:?}", e);
                        return;
                    }
                };

                let app_for_perm = app_handle.clone();
                let tab_for_perm = tab_id.clone();
                let handler = PermissionRequestedEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        let mut kind_val = Default::default();
                        let _ = args.PermissionKind(&mut kind_val);
                        let kind = permissions::kind_to_str(kind_val);

                        let mut uri_pwstr = windows_core::PWSTR::null();
                        let _ = args.Uri(&mut uri_pwstr);
                        let origin = take_pwstr(uri_pwstr);

                        match permissions::lookup_decision(&origin, kind) {
                            Some(allow) => {
                                // Remembered — apply synchronously, no prompt.
                                let state = if allow {
                                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                                } else {
                                    COREWEBVIEW2_PERMISSION_STATE_DENY
                                };
                                let _ = args.SetState(state);
                            }
                            None => {
                                // Unremembered — defer and ask the user.
                                match args.GetDeferral() {
                                    Ok(deferral) => {
                                        let request_id = permissions::stash_pending(args.clone(), deferral);
                                        let _ = app_for_perm.emit(
                                            "lens-permission-request",
                                            serde_json::json!({
                                                "tabId": tab_for_perm,
                                                "requestId": request_id,
                                                "kind": kind,
                                                "uri": origin,
                                            }),
                                        );
                                    }
                                    Err(e) => {
                                        warn!("[lens] Failed to get permission deferral, denying: {:?}", e);
                                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                                    }
                                }
                            }
                        }
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = core_webview.add_PermissionRequested(&handler, &mut token) {
                    warn!("[lens] Failed to register PermissionRequested: {:?}", e);
                }
            }
        }
    });
}

/// Override the child WebView2's user-agent with a current desktop-Chrome UA so
/// identity providers (notably Google, which 403s embedded webviews) don't
/// reject OAuth flows.
///
/// Uses `ICoreWebView2Settings2::put_UserAgent` (`SetUserAgent`), which applies
/// to subsequent navigations. `ICoreWebView2Settings2` ships with every modern
/// WebView2 runtime (Edge 85+); if the cast fails on an unexpectedly old runtime
/// we log a warning and leave the default UA in place rather than failing.
fn set_desktop_user_agent(webview: &tauri::Webview) {
    const DESKTOP_CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    let _ = webview.with_webview(|platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::{HSTRING, Interface};

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for user-agent override: {:?}", e);
                        return;
                    }
                };

                let settings = match core_webview.Settings() {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("[lens] Failed to get WebView2 settings: {:?}", e);
                        return;
                    }
                };

                let settings2: ICoreWebView2Settings2 = match settings.cast() {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("[lens] ICoreWebView2Settings2 unavailable — keeping default UA: {:?}", e);
                        return;
                    }
                };

                if let Err(e) = settings2.SetUserAgent(&HSTRING::from(DESKTOP_CHROME_UA)) {
                    warn!("[lens] Failed to set desktop user agent: {:?}", e);
                } else {
                    info!("[lens] Desktop-Chrome user agent applied to child webview");
                }
            }
        }
    });
}

/// Pick a collision-free path for `filename` inside `dir` — "file (2).zip"
/// style, like every browser.
fn unique_download_path(dir: &std::path::Path, filename: &str) -> String {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate.to_string_lossy().into_owned();
    }
    let p = std::path::Path::new(filename);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "download".into());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..1000u32 {
        let c = dir.join(format!("{} ({}){}", stem, n, ext));
        if !c.exists() {
            return c.to_string_lossy().into_owned();
        }
    }
    candidate.to_string_lossy().into_owned()
}

/// Hook the WebView2 `DownloadStarting` event so file downloads are tracked
/// and progress is emitted to the frontend.  Called once per newly-created
/// child webview.
///
/// `SetHandled(false)` lets WebView2 use its built-in Save-As dialog while we
/// still receive state-change and progress callbacks.
fn register_download_handler(
    app: &AppHandle,
    webview: &tauri::Webview,
    downloads: Arc<Mutex<Vec<DownloadEntry>>>,
) {
    let app_handle = app.clone();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::{
                DownloadStartingEventHandler,
                StateChangedEventHandler,
                BytesReceivedChangedEventHandler,
                take_pwstr,
            };
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;

            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => {
                        warn!("[lens] Failed to get CoreWebView2 for download handler: {:?}", e);
                        return;
                    }
                };

                let wv4: ICoreWebView2_4 = match core_webview.cast() {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("[lens] Failed to cast to ICoreWebView2_4: {:?}", e);
                        return;
                    }
                };

                let downloads_for_handler = downloads.clone();
                let app_for_handler = app_handle.clone();

                let handler = DownloadStartingEventHandler::create(Box::new(
                    move |_sender, args| {
                        let args = match args {
                            Some(a) => a,
                            None => return Ok(()),
                        };

                        // Get download operation
                        let download_op = args.DownloadOperation()?;

                        // Get result file path from args (where WebView2 will save)
                        let mut result_path_pwstr = windows_core::PWSTR::null();
                        args.ResultFilePath(&mut result_path_pwstr)?;
                        let mut result_path = take_pwstr(result_path_pwstr);

                        // Extract filename from the path
                        let filename = std::path::Path::new(&result_path)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "download".to_string());

                        // Honor browser download settings (previously declared
                        // in config but wired to nothing):
                        //  - ask_location → native Save-As dialog (SetHandled(false))
                        //  - otherwise    → silent download, to the configured
                        //    folder if set+valid, else WebView2's default
                        //    Downloads path. Chrome-like default.
                        let browser_cfg = crate::commands::config::get_config_snapshot().browser;
                        let ask_location = browser_cfg.download_ask_location;
                        if !ask_location {
                            if let Some(dir) = browser_cfg
                                .download_path
                                .as_deref()
                                .filter(|d| !d.is_empty())
                            {
                                let dir_path = std::path::Path::new(dir);
                                if dir_path.is_dir() {
                                    let target = unique_download_path(dir_path, &filename);
                                    let hpath = windows_core::HSTRING::from(target.as_str());
                                    if args.SetResultFilePath(windows_core::PCWSTR(hpath.as_ptr())).is_ok() {
                                        result_path = target;
                                    }
                                }
                            }
                        }

                        // Get URI from download operation
                        let mut uri_pwstr = windows_core::PWSTR::null();
                        download_op.Uri(&mut uri_pwstr)?;
                        let uri = take_pwstr(uri_pwstr);

                        // Get total bytes
                        let mut total_bytes: i64 = -1;
                        let _ = download_op.TotalBytesToReceive(&mut total_bytes);

                        // Generate unique download ID
                        let dl_id = format!("dl-{}", DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed));

                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();

                        let entry = DownloadEntry {
                            id: dl_id.clone(),
                            filename: filename.clone(),
                            url: uri.clone(),
                            total_bytes,
                            received_bytes: 0,
                            state: "downloading".to_string(),
                            path: result_path.clone(),
                            timestamp,
                        };

                        // Store entry
                        if let Ok(mut guard) = downloads_for_handler.lock() {
                            guard.push(entry.clone());
                        }

                        // Emit start event
                        let _ = app_for_handler.emit(
                            "lens-download-started",
                            serde_json::json!({
                                "id": dl_id,
                                "filename": filename,
                                "url": uri,
                                "totalBytes": total_bytes,
                                "receivedBytes": 0,
                                "state": "downloading",
                                "path": result_path,
                                "timestamp": timestamp,
                            }),
                        );

                        info!("[lens] Download started: {} -> {}", filename, result_path);

                        // ask_location → WebView2's Save-As dialog; otherwise
                        // handled == silent download straight to result_path.
                        args.SetHandled(!ask_location)?;

                        // Register BytesReceivedChanged handler for progress updates
                        {
                            let dl_id_progress = dl_id.clone();
                            let app_progress = app_for_handler.clone();
                            let downloads_progress = downloads_for_handler.clone();

                            let progress_handler = BytesReceivedChangedEventHandler::create(
                                Box::new(move |sender, _args| {
                                    let op = match sender {
                                        Some(ref op) => op,
                                        None => return Ok(()),
                                    };

                                    let mut received: i64 = 0;
                                    let _ = op.BytesReceived(&mut received);
                                    let mut total: i64 = -1;
                                    let _ = op.TotalBytesToReceive(&mut total);

                                    // Update in-memory entry
                                    if let Ok(mut guard) = downloads_progress.lock() {
                                        if let Some(entry) = guard.iter_mut().find(|e| e.id == dl_id_progress) {
                                            entry.received_bytes = received;
                                            if total > 0 {
                                                entry.total_bytes = total;
                                            }
                                        }
                                    }

                                    let _ = app_progress.emit(
                                        "lens-download-progress",
                                        serde_json::json!({
                                            "id": dl_id_progress,
                                            "receivedBytes": received,
                                            "totalBytes": total,
                                        }),
                                    );

                                    Ok(())
                                }),
                            );

                            let mut progress_token: i64 = 0;
                            let _ = download_op.add_BytesReceivedChanged(
                                &progress_handler,
                                &mut progress_token,
                            );
                        }

                        // Register StateChanged handler for completion/interruption
                        {
                            let dl_id_state = dl_id.clone();
                            let app_state = app_for_handler.clone();
                            let downloads_state = downloads_for_handler.clone();

                            let state_handler = StateChangedEventHandler::create(Box::new(
                                move |sender, _args| {
                                    let op = match sender {
                                        Some(ref op) => op,
                                        None => return Ok(()),
                                    };

                                    let mut download_state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
                                    op.State(&mut download_state)?;

                                    let mut received: i64 = 0;
                                    let _ = op.BytesReceived(&mut received);
                                    let mut total: i64 = -1;
                                    let _ = op.TotalBytesToReceive(&mut total);

                                    // Get the final result file path (may differ from initial)
                                    let mut final_path_pwstr = windows_core::PWSTR::null();
                                    let _ = op.ResultFilePath(&mut final_path_pwstr);
                                    let final_path = take_pwstr(final_path_pwstr);

                                    let state_str = match download_state {
                                        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => "completed",
                                        COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED => "interrupted",
                                        _ => "downloading",
                                    };

                                    // Update in-memory entry; persist finished
                                    // downloads so the panel survives restart
                                    if let Ok(mut guard) = downloads_state.lock() {
                                        if let Some(entry) = guard.iter_mut().find(|e| e.id == dl_id_state) {
                                            entry.state = state_str.to_string();
                                            entry.received_bytes = received;
                                            if total > 0 {
                                                entry.total_bytes = total;
                                            }
                                            if !final_path.is_empty() {
                                                entry.path = final_path.clone();
                                            }
                                        }
                                        if state_str != "downloading" {
                                            super::downloads::persist_finished(&guard);
                                        }
                                    }

                                    let _ = app_state.emit(
                                        "lens-download-progress",
                                        serde_json::json!({
                                            "id": dl_id_state,
                                            "receivedBytes": received,
                                            "totalBytes": total,
                                            "state": state_str,
                                            "path": final_path,
                                        }),
                                    );

                                    if state_str != "downloading" {
                                        info!("[lens] Download {}: {} ({})", state_str, dl_id_state, final_path);
                                    }

                                    Ok(())
                                },
                            ));

                            let mut state_token: i64 = 0;
                            let _ = download_op.add_StateChanged(
                                &state_handler,
                                &mut state_token,
                            );
                        }

                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if let Err(e) = wv4.add_DownloadStarting(&handler, &mut token) {
                    warn!("[lens] Failed to register download handler: {:?}", e);
                } else {
                    info!("[lens] Download handler registered (token={})", token);
                }
            }
        }
    });
}

/// Internal helper: create a WebView2 child webview for a browser tab.
/// Returns the webview label on success.
pub(super) async fn create_tab_webview(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    downloads: Arc<Mutex<Vec<DownloadEntry>>>,
) -> Result<String, String> {
    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let label = format!("lens-{}", timestamp);

    let app_clone = app.clone();
    let app_for_download = app.clone();
    let label_clone = label.clone();
    let tab_id_clone = tab_id.to_string();
    let shortcut_script = build_shortcut_script();

    // Run WebView2 creation on a blocking thread to prevent hanging the
    // tokio runtime. WebView2 initialization on Windows can block for
    // several hundred milliseconds while the browser process starts.
    let create_result = tokio::task::spawn_blocking(move || {
        let Some(window) = app_clone.get_window("main") else {
            return Err("Main window not found".to_string());
        };

        let app_for_handler = app_clone.clone();
        let tab_id_for_handler = tab_id_clone.clone();
        let builder =
            WebviewBuilder::new(&label_clone, tauri::WebviewUrl::External(parsed_url))
                .initialization_script(IPC_CRASH_GUARD_SCRIPT)
                .initialization_script(&shortcut_script)
                .initialization_script(CACHE_SCRIPT)
                .initialization_script(CONSOLE_HOOK_SCRIPT)
                .on_page_load(move |webview, payload| {
                    // Started → per-tab loading on (drives the tab spinner + the
                    // per-nav progress bar). Finished → loading off + url/title.
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                        let _ = app_for_handler.emit(
                            "lens-loading-changed",
                            serde_json::json!({ "tabId": tab_id_for_handler, "loading": true }),
                        );
                    }
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let url_str = payload.url().to_string();
                        info!("[lens] Page load finished (tab {}): {}", tab_id_for_handler, url_str);
                        let _ = app_for_handler.emit(
                            "lens-loading-changed",
                            serde_json::json!({ "tabId": tab_id_for_handler, "loading": false }),
                        );
                        let _ = app_for_handler.emit(
                            "lens-url-changed",
                            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
                        );
                        let _ = app_for_handler.emit(
                            "lens-history-entry",
                            serde_json::json!({ "url": url_str, "tabId": tab_id_for_handler }),
                        );
                        // Extract page title via COM API and emit lens-title-changed event
                        report_page_title(&app_for_handler, &webview, tab_id_for_handler.clone());
                    }
                });

        info!("[lens] Calling window.add_child for {} (tab {})", label_clone, tab_id_clone);

        match window.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        ) {
            Ok(webview_ref) => {
                info!("[lens] Webview created successfully: {} (tab {})", label_clone, tab_id_clone);
                register_custom_scheme_handler(&app_for_download, &webview_ref);
                register_download_handler(&app_for_download, &webview_ref, downloads);
                register_new_window_handler(&app_for_download, &webview_ref);
                register_navigation_state_handlers(&app_for_download, &webview_ref, &tab_id_clone);
                register_cert_error_handler(&app_for_download, &webview_ref, &tab_id_clone);
                register_fullscreen_handler(&app_for_download, &webview_ref, &tab_id_clone);
                register_audio_handlers(&app_for_download, &webview_ref, &tab_id_clone);
                register_permission_handler(&app_for_download, &webview_ref, &tab_id_clone);
                set_desktop_user_agent(&webview_ref);
                Ok(label_clone)
            }
            Err(e) => {
                warn!("[lens] Failed to create webview: {}", e);
                Err(format!("Failed to create webview: {}", e))
            }
        }
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))?
    .map_err(|e| e)?;

    Ok(create_result)
}
