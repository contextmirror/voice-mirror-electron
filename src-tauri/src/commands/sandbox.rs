//! Sandbox mode commands.
//!
//! Sandbox mode runs an app *being built* in its own isolated process (launched
//! with `--remote-debugging-port`) and drives it over CDP — so it can't crash
//! Voice Mirror, and the AI can see/interact with the real running app through
//! the same element-ref model it uses for websites.

use serde::Deserialize;

use super::IpcResponse;
use crate::services::launch::LaunchAck;

/// Snapshot an external app's UI via its CDP remote-debugging `port`.
///
/// Returns `{ pageUrl, tree, refCount }` where `tree` is the accessibility tree
/// rendered to `@ref` element refs (the same format the AI uses for the browser).
#[tauri::command]
pub async fn sandbox_snapshot(port: u16, window: Option<String>) -> IpcResponse {
    match crate::services::sandbox::snapshot(port, window.as_deref()).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Click an element in the sandboxed app by its `@ref` (from the last snapshot).
#[tauri::command]
pub async fn sandbox_click(port: u16, element_ref: String) -> IpcResponse {
    match crate::services::sandbox::click(port, &element_ref).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Type `text` into an element in the sandboxed app by its `@ref`.
#[tauri::command]
pub async fn sandbox_type(port: u16, element_ref: String, text: String) -> IpcResponse {
    match crate::services::sandbox::type_text(port, &element_ref, &text).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Screenshot the sandboxed app's web contents (JPEG). Returns `{ base64, contentType }`.
#[tauri::command]
pub async fn sandbox_screenshot(port: u16) -> IpcResponse {
    match crate::services::sandbox::screenshot(port).await {
        Ok(v) => IpcResponse::ok(v),
        Err(e) => IpcResponse::err(e),
    }
}

/// Record the CDP port of the active sandbox app, so the sandbox MCP tools can
/// default to it when the AI omits an explicit `port`. Refuses to register a port
/// whose page is Voice Mirror itself (e.g. a dev app that collided on the host's
/// own dev port and ended up showing the host frontend) — best-effort: if the
/// app's CDP isn't up yet the check is skipped and snapshot-time exclusion still
/// guards driving.
#[tauri::command]
pub async fn sandbox_set_active_port(port: u16) -> IpcResponse {
    if crate::services::sandbox::port_is_host(port).await {
        return IpcResponse::err(format!(
            "Refusing to register port {} as the sandbox — it's showing Voice Mirror itself, \
             not the app being built.",
            port
        ));
    }
    crate::services::sandbox::set_active_cdp_port(Some(port));
    IpcResponse::ok(serde_json::json!({ "port": port }))
}

/// Clear the active sandbox CDP port (e.g. when the dev server stops/crashes).
#[tauri::command]
pub fn sandbox_clear_active_port() -> IpcResponse {
    crate::services::sandbox::set_active_cdp_port(None);
    IpcResponse::ok(serde_json::json!({ "ok": true }))
}

/// Start a live mirror of the app on `port` (optionally a specific window
/// `hwnd`). Returns `{ mjpegPort, url, hwnd }` — point an `<img>` at `url`.
/// `hwnd` is the captured OS window for the WGC source, or `null` for the CDP
/// screencast fallback (an opaque window WGC can't capture — it has no single OS
/// window). A `null` hwnd leaves the frontend's `currentHwnd` untouched, so its
/// auto-follow stays dormant until a real, capturable window appears.
#[tauri::command]
pub async fn sandbox_stream_start(port: u16, hwnd: Option<i64>) -> IpcResponse {
    match crate::services::sandbox_stream::start(port, hwnd).await {
        Ok((mjpeg_port, chosen_hwnd)) => IpcResponse::ok(serde_json::json!({
            "mjpegPort": mjpeg_port,
            "url": format!("http://127.0.0.1:{}/stream", mjpeg_port),
            "hwnd": chosen_hwnd,
        })),
        Err(e) => IpcResponse::err(e),
    }
}

/// The OS window (HWND) Claude is currently driving — the live preview mirrors
/// this so the human watches exactly the window Claude acts on. `null` until the
/// first snapshot. Returns `{ hwnd }`.
#[tauri::command]
pub fn sandbox_active_hwnd() -> IpcResponse {
    IpcResponse::ok(serde_json::json!({ "hwnd": crate::services::sandbox::active_hwnd() }))
}

/// List the app's visible windows (pill, settings, dialogs) for the preview
/// switcher / auto-follow. Returns `[{ hwnd, title }]`.
#[tauri::command]
pub async fn sandbox_list_windows(port: u16) -> IpcResponse {
    match crate::services::sandbox_stream::list_windows(port).await {
        Ok(windows) => IpcResponse::ok(serde_json::to_value(windows).unwrap_or_default()),
        Err(e) => IpcResponse::err(e),
    }
}

/// Stop the live screencast for the app on `port`.
#[tauri::command]
pub fn sandbox_stream_stop(port: u16) -> IpcResponse {
    crate::services::sandbox_stream::stop(port);
    IpcResponse::ok(serde_json::json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStartAckParams {
    pub launch_id: u64,
    #[serde(flatten)]
    pub ack: LaunchAck,
}

/// The frontend's mandatory acknowledgement of a `sandbox-start-request` event.
/// Resolves the backend waiter registered by the `sandbox_start` MCP tool, so
/// the tool's response reports what ACTUALLY happened (spawned / already-running
/// / refused) instead of optimistically claiming a launch.
#[tauri::command]
pub fn sandbox_start_ack(params: SandboxStartAckParams) -> IpcResponse {
    tracing::info!(
        target: "preview",
        "[launch:{}] frontend ack: status={} reason={:?} devPort={:?} cdpPort={:?} framework={:?}",
        params.launch_id,
        params.ack.status,
        params.ack.reason,
        params.ack.dev_port,
        params.ack.cdp_port,
        params.ack.framework,
    );
    let delivered = crate::services::launch::ack(params.launch_id, params.ack);
    if !delivered {
        // The waiter already timed out (reported "dropped") or the id is stale.
        tracing::warn!(
            target: "preview",
            "[launch:{}] ack arrived but nothing was waiting (backend timed out first?)",
            params.launch_id
        );
    }
    IpcResponse::ok(serde_json::json!({ "delivered": delivered }))
}

/// Allocate a genuinely free CDP debug port for a dev-app launch. Replaces the
/// old `9223 + (dev_port % 1000)` formula, which collided for dev ports 1000
/// apart (3000/4000, 1420/2420) and was duplicated in JS + Rust.
#[tauri::command]
pub fn find_free_cdp_port() -> IpcResponse {
    match crate::services::launch::find_free_cdp_port() {
        Some(port) => IpcResponse::ok(serde_json::json!({ "port": port })),
        None => IpcResponse::err("No free CDP port in the 9223-9499 scan range"),
    }
}

/// Bridge the project's pinned package manager (yarn/pnpm) via corepack when
/// it isn't globally installed, so `sandbox_start` can launch repos like
/// excalidraw (`packageManager: yarn@1.22.22`, start = `yarn && vite`) on a
/// machine with only npm. Returns `{ pathPrepend }` — the shim dir the caller
/// prepends to the dev-server PTY's PATH — or `{ pathPrepend: null }` when no
/// bridge is needed (manager already on PATH, is npm/bun, or no corepack).
#[tauri::command]
pub fn ensure_corepack_shims(project_path: String) -> IpcResponse {
    let dir = crate::services::dev_server::ensure_corepack_shims(&project_path);
    IpcResponse::ok(serde_json::json!({ "pathPrepend": dir }))
}
