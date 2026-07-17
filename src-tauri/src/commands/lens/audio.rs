//! Per-tab audio commands (mute toggle).

use tauri::{AppHandle, Manager};

use super::super::IpcResponse;
use super::LensState;

/// Toggle the muted state of a browser tab's WebView2 (ICoreWebView2_8
/// `IsMuted`/`SetIsMuted`). Returns `{ muted }` with the NEW state.
///
/// The `IsMutedChanged` handler registered on the webview also fires and emits
/// `lens-audio-state`, but we return the resolved value so the caller can update
/// optimistically without waiting for the event round-trip.
#[tauri::command]
pub fn lens_toggle_tab_mute(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    let webview = match app.get_webview(&label) {
        Some(w) => w,
        None => return IpcResponse::err("Webview not found"),
    };

    let (tx, rx) = std::sync::mpsc::channel::<Result<bool, String>>();
    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows_core::Interface;
            unsafe {
                let controller = platform_webview.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => { let _ = tx.send(Err(format!("No CoreWebView2: {:?}", e))); return; }
                };
                let wv8: ICoreWebView2_8 = match core.cast() {
                    Ok(v) => v,
                    Err(e) => { let _ = tx.send(Err(format!("ICoreWebView2_8 unavailable: {:?}", e))); return; }
                };
                let mut cur = windows_core::BOOL::from(false);
                if let Err(e) = wv8.IsMuted(&mut cur) {
                    let _ = tx.send(Err(format!("IsMuted failed: {:?}", e)));
                    return;
                }
                let next = !cur.as_bool();
                if let Err(e) = wv8.SetIsMuted(next) {
                    let _ = tx.send(Err(format!("SetIsMuted failed: {:?}", e)));
                    return;
                }
                let _ = tx.send(Ok(next));
            }
        }
        #[cfg(not(windows))]
        {
            let _ = tx.send(Err("Tab mute is Windows-only".into()));
        }
    });

    match rx.recv_timeout(std::time::Duration::from_secs(2)) {
        Ok(Ok(muted)) => IpcResponse::ok(serde_json::json!({ "muted": muted })),
        Ok(Err(e)) => IpcResponse::err(&e),
        Err(_) => IpcResponse::err("Mute toggle timed out"),
    }
}
