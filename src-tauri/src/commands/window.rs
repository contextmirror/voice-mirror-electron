use super::IpcResponse;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

/// Managed state for the performance monitor.
/// Holds a persistent `System` instance so CPU deltas are accurate across calls.
pub type PerfMonitorState = std::sync::Mutex<System>;

/// Get the current window position and size.
#[tauri::command]
pub fn get_window_position(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to get position: {}", e)),
    };

    let size = match window.outer_size() {
        Ok(s) => s,
        Err(e) => return IpcResponse::err(format!("Failed to get size: {}", e)),
    };

    IpcResponse::ok(serde_json::json!({
        "x": pos.x,
        "y": pos.y,
        "width": size.width,
        "height": size.height,
    }))
}

/// Set the window position.
#[tauri::command]
pub fn set_window_position(app: AppHandle, x: f64, y: f64) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    let position = tauri::PhysicalPosition::new(x as i32, y as i32);
    match window.set_position(tauri::Position::Physical(position)) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set position: {}", e)),
    }
}

/// Minimize the window.
#[tauri::command]
pub fn minimize_window(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    match window.minimize() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to minimize: {}", e)),
    }
}

/// Set the window size.
#[tauri::command]
pub fn set_window_size(app: AppHandle, width: f64, height: f64) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    let size = tauri::PhysicalSize::new(width as u32, height as u32);
    match window.set_size(tauri::Size::Physical(size)) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set size: {}", e)),
    }
}

/// Set always-on-top state.
#[tauri::command]
pub fn set_always_on_top(app: AppHandle, value: bool) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    match window.set_always_on_top(value) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set always-on-top: {}", e)),
    }
}

/// Set whether the window is resizable.
#[tauri::command]
pub fn set_resizable(app: AppHandle, value: bool) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    match window.set_resizable(value) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to set resizable: {}", e)),
    }
}

/// Show the main window.
/// Called by the frontend after Svelte has mounted and set the correct
/// mode (overlay vs dashboard). This prevents the black-square flash
/// that occurs when Rust shows the window before CSS/HTML has loaded.
#[tauri::command]
pub fn show_window(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };
    match window.show() {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to show window: {}", e)),
    }
}

/// Get current process CPU and memory stats.
/// CPU requires a persistent System instance (managed state) so the delta
/// between refreshes produces meaningful percentages.
#[tauri::command]
pub fn get_process_stats(
    state: tauri::State<'_, PerfMonitorState>,
) -> IpcResponse {
    let mut sys = match state.lock() {
        Ok(guard) => guard,
        Err(e) => return IpcResponse::err(format!("Failed to lock perf state: {}", e)),
    };

    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::everything(),
    );

    match sys.process(pid) {
        Some(proc) => IpcResponse::ok(serde_json::json!({
            "cpu": proc.cpu_usage(),
            "rss": proc.memory() / 1_048_576,
        })),
        None => IpcResponse::ok(serde_json::json!({
            "cpu": 0.0,
            "rss": 0,
        })),
    }
}
