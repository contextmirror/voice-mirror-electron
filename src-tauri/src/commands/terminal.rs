//! Tauri commands for managing independent terminal sessions.
//!
//! These commands expose `TerminalManager` operations to the frontend,
//! enabling tabbed terminal support alongside the AI agent terminal.

use std::sync::Mutex;

use serde_json::json;
use tauri::State;

use super::IpcResponse;

/// Managed Tauri state wrapping the terminal manager.
pub struct TerminalManagerState(pub Mutex<crate::terminal::TerminalManager>);

/// Helper macro for locking the terminal manager with clean error handling.
macro_rules! lock_terminal {
    ($state:expr) => {
        match $state.0.lock() {
            Ok(guard) => guard,
            Err(e) => return IpcResponse::err(format!("Terminal manager lock poisoned: {}", e)),
        }
    };
}

/// Spawn a new terminal PTY session.
///
/// Returns `{ "id": "terminal-1" }` on success.
/// If `profile_id` is provided, spawns using the matching shell profile.
/// If `output_channel` is provided, PTY stdout is also mirrored to that project output channel.
// `(async)` runs this on a worker thread instead of the main/UI thread —
// spawning a PTY + shell is blocking work that would freeze the window.
#[tauri::command(async)]
pub fn terminal_spawn(
    state: State<'_, TerminalManagerState>,
    output_state: State<'_, std::sync::Arc<crate::services::output::OutputStore>>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    profile_id: Option<String>,
    output_channel: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    if let Some(ref dir) = cwd {
        let path = std::path::Path::new(dir);
        if !path.is_dir() {
            return IpcResponse::err(format!("cwd path does not exist or is not a directory: {}", dir));
        }
    }

    let store = if output_channel.is_some() {
        Some(output_state.inner().clone())
    } else {
        None
    };

    match manager.spawn(cols, rows, cwd, profile_id, output_channel, env, store) {
        Ok((id, profile_name)) => IpcResponse::ok(json!({ "id": id, "profileName": profile_name })),
        Err(e) => IpcResponse::err(e),
    }
}

/// Detect available terminal profiles (shells) on the system.
///
/// Returns a list of `TerminalProfile` objects.
#[tauri::command]
pub fn terminal_detect_profiles(
    state: State<'_, TerminalManagerState>,
) -> IpcResponse {
    let manager = lock_terminal!(state);
    let profiles = manager.detect_profiles();
    IpcResponse::ok(serde_json::to_value(profiles).unwrap_or_default())
}

/// Send input data to a terminal session.
#[tauri::command]
pub fn terminal_input(
    state: State<'_, TerminalManagerState>,
    id: String,
    data: String,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.send_input(&id, data.as_bytes()) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Resize a terminal session's PTY.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalManagerState>,
    id: String,
    cols: u16,
    rows: u16,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.resize(&id, cols, rows) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

/// Find the OS window of a NATIVE app launched in terminal session `id` (e.g.
/// `cargo run -p egui_demo_app`). Walks the PTY's process tree for a presentable
/// window. Returns `{ hwnd }` (null while the app hasn't shown a window yet — a
/// `cargo run` compiles first, so the frontend polls this). The native-app
/// counterpart to CDP-port window matching.
#[tauri::command(async)]
pub fn find_native_window(state: State<'_, TerminalManagerState>, id: String) -> IpcResponse {
    let pid = {
        let manager = lock_terminal!(state);
        manager.pid(&id)
    };
    let Some(pid) = pid else {
        return IpcResponse::ok(serde_json::json!({ "hwnd": serde_json::Value::Null }));
    };
    let hwnd = crate::services::sandbox::find_window_in_process_tree(pid);
    IpcResponse::ok(serde_json::json!({ "hwnd": hwnd }))
}

/// Whether an OS window still exists — native-app liveness (no CDP port to
/// probe). Returns `{ alive }`.
#[tauri::command]
pub fn is_window_alive(hwnd: i64) -> IpcResponse {
    IpcResponse::ok(serde_json::json!({ "alive": crate::services::sandbox::is_window_alive(hwnd) }))
}

/// Kill a terminal session.
// `(async)`: TerminalManager::kill runs taskkill and then waits up to 3s for
// the child to exit — far too long to block the main/UI thread.
#[tauri::command(async)]
pub fn terminal_kill(
    state: State<'_, TerminalManagerState>,
    id: String,
) -> IpcResponse {
    let mut manager = lock_terminal!(state);
    match manager.kill(&id) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}
