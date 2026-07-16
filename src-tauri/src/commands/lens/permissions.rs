//! Browser permission prompts.
//!
//! WebView2 fires `PermissionRequested` when a page asks for camera / mic /
//! geolocation / notifications / etc. We handle it ourselves so the decision
//! runs through a VM-styled prompt bar instead of WebView2's default UI, and so
//! choices persist per-site.
//!
//! ## Deferral flow (no double-prompt, real control)
//!
//! 1. `register_permission_handler` (in `webview_setup.rs`) runs on the WebView2
//!    UI thread. It first checks the persisted per-site decisions:
//!      - remembered → `SetState(ALLOW|DENY)` synchronously, no prompt.
//!      - unremembered → `GetDeferral()`, stash the (args, deferral) pair in a
//!        UI-thread `thread_local`, and emit `lens-permission-request`.
//! 2. The frontend shows a bar UNDER THE TOOLBAR (airspace-safe — it takes real
//!    layout space, pushing the child webview down) with Allow / Block.
//! 3. The answer calls `lens_permission_response`, which resolves the deferral
//!    on the main thread (`run_on_main_thread` targets the same UI thread the
//!    handler ran on, so the `thread_local` and COM objects are reachable) and
//!    persists the choice for next time.
//!
//! Tradeoff / known gap: there is no UI yet to review or reset remembered
//! decisions (they live in `browser-permissions.json`); resetting means editing
//! that file. If the UI-thread assumption behind `run_on_main_thread` ever fails
//! the failure is soft — the deferral just never completes and the page keeps
//! waiting for the permission — not a crash.

use super::super::IpcResponse;

fn permissions_path() -> std::path::PathBuf {
    crate::services::platform::get_data_dir().join("browser-permissions.json")
}

fn read_permissions() -> Vec<serde_json::Value> {
    if let Ok(data) = std::fs::read_to_string(permissions_path()) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_permissions(entries: &[serde_json::Value]) {
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(permissions_path(), json);
    }
}

/// Look up a remembered decision for `origin` + `kind`.
/// Returns `Some(true)` = allow, `Some(false)` = block, `None` = ask.
pub(crate) fn lookup_decision(origin: &str, kind: &str) -> Option<bool> {
    read_permissions().iter().find_map(|e| {
        let o = e.get("origin").and_then(|v| v.as_str())?;
        let k = e.get("kind").and_then(|v| v.as_str())?;
        if o == origin && k == kind {
            e.get("allow").and_then(|v| v.as_bool())
        } else {
            None
        }
    })
}

/// Persist a per-site decision (upsert by origin + kind).
fn remember_decision(origin: &str, kind: &str, allow: bool) {
    let mut entries = read_permissions();
    entries.retain(|e| {
        !(e.get("origin").and_then(|v| v.as_str()) == Some(origin)
            && e.get("kind").and_then(|v| v.as_str()) == Some(kind))
    });
    entries.push(serde_json::json!({ "origin": origin, "kind": kind, "allow": allow }));
    write_permissions(&entries);
}

/// Map a WebView2 permission-kind enum to a stable string used in the store,
/// the emitted event, and the prompt copy.
#[cfg(windows)]
pub(crate) fn kind_to_str(
    kind: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND,
) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match kind {
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
        COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => "geolocation",
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notifications",
        COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS => "sensors",
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "clipboard",
        COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY => "autoplay",
        COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS => "local-fonts",
        COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => "downloads",
        COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE => "file-access",
        COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT => "window-management",
        _ => "other",
    }
}

// ── Deferred requests, kept on the WebView2 UI thread ────────────────────────
#[cfg(windows)]
mod pending {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
    };

    static COUNTER: AtomicU64 = AtomicU64::new(1);

    thread_local! {
        static PENDING: RefCell<HashMap<u64, (ICoreWebView2PermissionRequestedEventArgs, ICoreWebView2Deferral)>> =
            RefCell::new(HashMap::new());
    }

    /// Stash a deferred request (UI thread). Returns its id for the frontend.
    pub(crate) fn stash(
        args: ICoreWebView2PermissionRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
    ) -> u64 {
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        PENDING.with(|p| p.borrow_mut().insert(id, (args, deferral)));
        id
    }

    /// Resolve a deferred request (UI thread): set the state + complete it.
    pub(crate) fn resolve(id: u64, allow: bool) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        };
        PENDING.with(|p| {
            if let Some((args, deferral)) = p.borrow_mut().remove(&id) {
                unsafe {
                    let state = if allow {
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW
                    } else {
                        COREWEBVIEW2_PERMISSION_STATE_DENY
                    };
                    let _ = args.SetState(state);
                    let _ = deferral.Complete();
                }
            }
        });
    }
}

/// Answer a pending permission prompt: resolve the deferred WebView2 request and
/// persist the choice for this origin + kind.
#[tauri::command]
pub fn lens_permission_response(
    app: tauri::AppHandle,
    request_id: u64,
    allow: bool,
    origin: String,
    kind: String,
) -> IpcResponse {
    remember_decision(&origin, &kind, allow);

    #[cfg(windows)]
    {
        // Resolve on the main (WebView2 UI) thread where the deferral + args live.
        if let Err(e) = app.run_on_main_thread(move || {
            pending::resolve(request_id, allow);
        }) {
            return IpcResponse::err(format!("Failed to resolve permission: {}", e));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request_id);
    }

    IpcResponse::ok_empty()
}

/// Return all remembered per-site permission decisions.
#[tauri::command]
pub fn lens_get_permissions() -> IpcResponse {
    IpcResponse::ok(serde_json::json!({ "entries": read_permissions() }))
}

/// Clear a remembered decision (origin + kind), or all decisions when both are
/// empty. Lets a future settings surface reset choices.
#[tauri::command]
pub fn lens_clear_permission(origin: String, kind: String) -> IpcResponse {
    if origin.is_empty() && kind.is_empty() {
        write_permissions(&[]);
        return IpcResponse::ok(serde_json::json!({ "entries": [] }));
    }
    let mut entries = read_permissions();
    entries.retain(|e| {
        !(e.get("origin").and_then(|v| v.as_str()) == Some(origin.as_str())
            && e.get("kind").and_then(|v| v.as_str()) == Some(kind.as_str()))
    });
    write_permissions(&entries);
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}

/// Stash a deferred request and return its id (called from the COM handler).
#[cfg(windows)]
pub(crate) fn stash_pending(
    args: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PermissionRequestedEventArgs,
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
) -> u64 {
    pending::stash(args, deferral)
}
