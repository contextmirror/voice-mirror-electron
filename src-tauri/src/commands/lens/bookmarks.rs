//! Browser bookmarks persistence (JSON file, newest-first).
//! Sibling of `history.rs` — same storage shape, same data dir.

use super::super::IpcResponse;

/// Sanity cap so the file can't grow unbounded.
const MAX_BOOKMARKS: usize = 500;

fn bookmarks_path() -> std::path::PathBuf {
    crate::services::platform::get_data_dir().join("browser-bookmarks.json")
}

fn read_bookmarks() -> Vec<serde_json::Value> {
    let path = bookmarks_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_bookmarks(entries: &[serde_json::Value]) {
    let path = bookmarks_path();
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(path, json);
    }
}

/// Add a bookmark (newest-first). Replaces an existing bookmark with the
/// same URL (updates its title) instead of duplicating.
#[tauri::command]
pub fn lens_add_bookmark(url: String, title: String) -> IpcResponse {
    if url.is_empty() || url == "about:blank" {
        return IpcResponse::err("Nothing to bookmark");
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut entries = read_bookmarks();
    entries.retain(|e| e.get("url").and_then(|v| v.as_str()) != Some(url.as_str()));

    entries.insert(0, serde_json::json!({
        "url": url,
        "title": title,
        "timestamp": timestamp,
    }));
    entries.truncate(MAX_BOOKMARKS);

    write_bookmarks(&entries);
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}

/// Remove a bookmark by URL.
#[tauri::command]
pub fn lens_remove_bookmark(url: String) -> IpcResponse {
    let mut entries = read_bookmarks();
    entries.retain(|e| e.get("url").and_then(|v| v.as_str()) != Some(url.as_str()));
    write_bookmarks(&entries);
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}

/// Return all bookmarks (newest first).
#[tauri::command]
pub fn lens_get_bookmarks() -> IpcResponse {
    let entries = read_bookmarks();
    IpcResponse::ok(serde_json::json!({ "entries": entries }))
}
