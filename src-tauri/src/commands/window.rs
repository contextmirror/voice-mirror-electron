use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::IpcResponse;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

/// Managed state for the performance monitor.
/// Holds a persistent `System` instance so CPU deltas are accurate across calls.
pub type PerfMonitorState = std::sync::Mutex<System>;

/// Get the current window position.
#[tauri::command]
pub fn get_window_position(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    match window.outer_position() {
        Ok(pos) => IpcResponse::ok(serde_json::json!({
            "x": pos.x,
            "y": pos.y,
        })),
        Err(e) => IpcResponse::err(format!("Failed to get position: {}", e)),
    }
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

/// Save current window position and size to config.
#[tauri::command]
pub fn save_window_bounds(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    // Read current position
    let position = match window.outer_position() {
        Ok(pos) => pos,
        Err(e) => return IpcResponse::err(format!("Failed to get position: {}", e)),
    };

    // Read current size
    let size = match window.outer_size() {
        Ok(s) => s,
        Err(e) => return IpcResponse::err(format!("Failed to get size: {}", e)),
    };

    // Build a config patch for the window section
    let patch = serde_json::json!({
        "window": {
            "orbX": position.x as f64,
            "orbY": position.y as f64,
        }
    });

    // Use the set_config command logic to persist
    // We import the persistence and platform modules directly to avoid
    // circular dependencies with the config command's static CONFIG.
    use crate::config::persistence;
    use crate::services::platform;

    let config_dir = platform::get_config_dir();
    let current_config = persistence::load_config(&config_dir);

    let current_val = match serde_json::to_value(&current_config) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(format!("Serialize error: {}", e)),
    };

    let merged = persistence::deep_merge(current_val, patch);

    let updated: crate::config::schema::AppConfig = match serde_json::from_value(merged) {
        Ok(c) => c,
        Err(e) => return IpcResponse::err(format!("Invalid config: {}", e)),
    };

    if let Err(e) = persistence::save_config(&config_dir, &updated) {
        return IpcResponse::err(e);
    }

    IpcResponse::ok(serde_json::json!({
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
    }))
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

/// Maximize or unmaximize the window (toggle).
#[tauri::command]
pub fn maximize_window(app: AppHandle) -> IpcResponse {
    let Some(window) = app.get_webview_window("main") else {
        return IpcResponse::err("Main window not found");
    };

    let is_max = window.is_maximized().unwrap_or(false);
    let result = if is_max {
        window.unmaximize()
    } else {
        window.maximize()
    };

    match result {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(format!("Failed to toggle maximize: {}", e)),
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

/// Quit the application.
#[tauri::command]
pub fn quit_app(app: AppHandle) -> IpcResponse {
    app.exit(0);
    IpcResponse::ok_empty()
}

/// Take a screenshot of the primary display.
///
/// Uses platform-native tools:
/// - Windows: PowerShell with .NET System.Drawing
/// - macOS: screencapture CLI
/// - Linux: cosmic-screenshot or gnome-screenshot or import (ImageMagick)
///
/// Saves to `{data_dir}/screenshots/screenshot-{timestamp}.png`.
/// Cleans up old screenshots, keeping the last 5.
#[tauri::command]
pub async fn take_screenshot() -> IpcResponse {
    let screenshots_dir = crate::services::platform::get_data_dir().join("screenshots");
    if let Err(e) = fs::create_dir_all(&screenshots_dir) {
        return IpcResponse::err(format!("Failed to create screenshots dir: {}", e));
    }

    // Clean up old screenshots (keep last 5)
    cleanup_old_screenshots(&screenshots_dir, 5);

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("screenshot-{}.png", now_ms);
    let filepath = screenshots_dir.join(&filename);
    let filepath_str = filepath.to_string_lossy().to_string();

    let result = tokio::task::spawn_blocking(move || {
        capture_screen_native(&filepath_str)
    })
    .await;

    match result {
        Ok(Ok(())) => IpcResponse::ok(serde_json::json!({ "path": filepath.to_string_lossy() })),
        Ok(Err(e)) => IpcResponse::err(e),
        Err(e) => IpcResponse::err(format!("Screenshot task panicked: {}", e)),
    }
}

/// Platform-native screen capture.
fn capture_screen_native(output_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // PowerShell one-liner: capture primary screen via .NET System.Drawing
        let ps_script = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Drawing.Rectangle]::FromLTRB(0,0,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $bmp = New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('{}'); $g.Dispose(); $bmp.Dispose()"#,
            output_path.replace('\'', "''")
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell screenshot failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("screencapture")
            .args(["-x", output_path])
            .output()
            .map_err(|e| format!("Failed to run screencapture: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("screencapture failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // Try cosmic-screenshot first
        if let Ok(output) = std::process::Command::new("cosmic-screenshot")
            .args(["--interactive=false", "--modal=false", "--notify=false",
                   &format!("--save-dir={}", Path::new(output_path).parent().unwrap_or(Path::new(".")).display())])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        // Try gnome-screenshot
        if let Ok(output) = std::process::Command::new("gnome-screenshot")
            .args(["-f", output_path])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        // Try import (ImageMagick)
        let output = std::process::Command::new("import")
            .args(["-window", "root", output_path])
            .output()
            .map_err(|e| format!("No screenshot tool available: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Screenshot failed: {}", stderr.trim()));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Screenshot not supported on this platform".into())
    }
}

/// Clean up old screenshots, keeping only the most recent `keep_count`.
fn cleanup_old_screenshots(dir: &Path, keep_count: usize) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut files: Vec<(std::path::PathBuf, SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "png")
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let mtime = meta.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();

    files.sort_by(|a, b| b.1.cmp(&a.1));

    if files.len() > keep_count {
        for (path, _) in &files[keep_count..] {
            let _ = fs::remove_file(path);
        }
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
