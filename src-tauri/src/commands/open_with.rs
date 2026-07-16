//! "Open with Voice Mirror" — file paths passed on the command line.
//!
//! When a file type is associated with the app, Explorer launches
//! `voice-mirror.exe "<path>"`. Two delivery paths:
//! - Fresh launch: `run()` captures argv into [`StartupOpenPaths`] managed
//!   state; the frontend drains it via [`take_startup_open_paths`] once the
//!   workspace has restored (so the file lands focused on top).
//! - Already running: the single-instance plugin forwards the second
//!   launch's argv; lib.rs emits an `open-file-request` event per file.

use super::IpcResponse;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Managed state: file paths from the launching command line, waiting for
/// the frontend to mount and collect them.
pub struct StartupOpenPaths(pub Mutex<Vec<String>>);

/// Extract openable file paths from a raw argv. Skips the executable (first
/// element) and flag-style arguments; resolves relative paths against `cwd`;
/// keeps only paths that exist and are files. Directories are ignored — the
/// project model is driven from the sidebar, not the shell.
pub fn extract_open_paths(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.is_empty())
        .filter_map(|a| {
            let p = PathBuf::from(a);
            let abs = if p.is_absolute() { p } else { cwd.join(p) };
            abs.is_file()
                .then(|| abs.to_string_lossy().into_owned())
        })
        .collect()
}

/// Drain the startup open paths. One-shot: returns them once, empty after.
#[tauri::command]
pub fn take_startup_open_paths(state: State<'_, StartupOpenPaths>) -> IpcResponse {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let paths: Vec<String> = guard.drain(..).collect();
    IpcResponse::ok(serde_json::json!(paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_exe_and_flags_and_missing_files() {
        let cwd = std::env::temp_dir();
        let file = cwd.join("vm-open-with-test.txt");
        std::fs::write(&file, "x").unwrap();
        let args = vec![
            "voice-mirror.exe".to_string(),
            "--flag".to_string(),
            file.to_string_lossy().into_owned(),
            cwd.join("does-not-exist-xyz.txt").to_string_lossy().into_owned(),
            cwd.to_string_lossy().into_owned(), // directory → ignored
        ];
        let got = extract_open_paths(&args, &cwd);
        assert_eq!(got, vec![file.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn resolves_relative_paths_against_cwd() {
        let cwd = std::env::temp_dir();
        let file = cwd.join("vm-open-with-rel.txt");
        std::fs::write(&file, "x").unwrap();
        let args = vec!["exe".to_string(), "vm-open-with-rel.txt".to_string()];
        let got = extract_open_paths(&args, &cwd);
        assert_eq!(got, vec![file.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_file(&file);
    }
}
