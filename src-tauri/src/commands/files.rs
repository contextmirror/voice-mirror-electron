use super::IpcResponse;
use crate::util::find_project_root;
use std::path::PathBuf;
use tracing::{info, warn};

/// List the contents of a directory within the project root.
///
/// If `path` is None, lists the project root. Otherwise, lists the subdirectory
/// relative to the project root. Returns entries sorted: directories first, then
/// files, alphabetical within each group.
///
/// When `root` is provided, uses that path instead of auto-detecting the project root.
#[tauri::command]
pub fn list_directory(path: Option<String>, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = match &path {
        Some(p) => root.join(p),
        None => root.clone(),
    };

    // Security: canonicalize both paths and verify target is within root
    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };
    let canon_target = match target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Path not found: {}", e)),
    };

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    // Build gitignore matcher from project root .gitignore
    let mut gitignore_builder = ignore::gitignore::GitignoreBuilder::new(&root);
    let gitignore_path = root.join(".gitignore");
    if gitignore_path.exists() {
        gitignore_builder.add(&gitignore_path);
    }
    let gitignore = gitignore_builder.build().unwrap_or_else(|e| {
        warn!("Failed to parse .gitignore: {}", e);
        ignore::gitignore::GitignoreBuilder::new(&root)
            .build()
            .unwrap()
    });

    // Read directory entries
    let entries = match std::fs::read_dir(&canon_target) {
        Ok(e) => e,
        Err(e) => return IpcResponse::err(format!("Failed to read directory: {}", e)),
    };

    let mut dirs: Vec<serde_json::Value> = Vec::new();
    let mut files: Vec<serde_json::Value> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip .git and .DS_Store
        if name == ".git" || name == ".DS_Store" {
            continue;
        }

        let full_path = entry.path();
        let is_dir = full_path.is_dir();

        // Compute path relative to project root
        let rel_path = match full_path.strip_prefix(&canon_root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => name.clone(),
        };

        // Check if ignored by .gitignore
        let ignored = gitignore
            .matched_path_or_any_parents(&rel_path, is_dir)
            .is_ignore();

        let entry_type = if is_dir { "directory" } else { "file" };

        let entry_json = serde_json::json!({
            "name": name,
            "path": rel_path,
            "type": entry_type,
            "ignored": ignored,
        });

        if is_dir {
            dirs.push(entry_json);
        } else {
            files.push(entry_json);
        }
    }

    // Sort alphabetically within each group (case-insensitive)
    dirs.sort_by(|a, b| {
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.to_lowercase().cmp(&b_name.to_lowercase())
    });
    files.sort_by(|a, b| {
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.to_lowercase().cmp(&b_name.to_lowercase())
    });

    // Directories first, then files
    let mut result = dirs;
    result.append(&mut files);

    info!(
        "list_directory: {} ({} entries)",
        path.as_deref().unwrap_or("/"),
        result.len()
    );

    IpcResponse::ok(serde_json::json!(result))
}

/// Get git status changes (added, modified, deleted files).
///
/// Returns `{ "changes": [...] }` where each change has a `path` and `status`.
/// If git is not available or the project is not a git repo, returns empty changes.
///
/// When `root` is provided, uses that path as CWD for git instead of auto-detecting.
#[tauri::command]
pub fn get_git_changes(root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let output = match std::process::Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            info!("git status failed (git may not be installed): {}", e);
            return IpcResponse::ok(serde_json::json!({ "changes": [] }));
        }
    };

    if !output.status.success() {
        info!("git status returned non-zero (may not be a git repo)");
        return IpcResponse::ok(serde_json::json!({ "changes": [] }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes: Vec<serde_json::Value> = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }

        let xy = &line[..2];
        let path_part = line[3..].trim();

        let status = match xy {
            "??" => "added",
            "A " | "AM" => "added",
            "D " | " D" => "deleted",
            "M " | " M" | "MM" => "modified",
            _ if xy.starts_with('R') => "modified",
            _ => "modified",
        };

        // For renames (R_), extract the new path after " -> "
        let file_path = if xy.starts_with('R') {
            path_part
                .split(" -> ")
                .last()
                .unwrap_or(path_part)
        } else {
            path_part
        };

        changes.push(serde_json::json!({
            "path": file_path,
            "status": status,
        }));
    }

    info!("get_git_changes: {} changes", changes.len());
    IpcResponse::ok(serde_json::json!({ "changes": changes }))
}

/// Get the project root directory path.
#[tauri::command]
pub fn get_project_root() -> IpcResponse {
    match find_project_root() {
        Some(root) => {
            let root_str = root.to_string_lossy().to_string();
            IpcResponse::ok(serde_json::json!({ "root": root_str }))
        }
        None => IpcResponse::err("Could not find project root"),
    }
}

/// Read a file's contents as UTF-8 text.
///
/// `path` is relative to the project root (or the provided `root`).
/// Returns `{ content, path, size }` on success.
#[tauri::command]
pub fn read_file(path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = root.join(&path);

    // Security: canonicalize both paths and verify target is within root
    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };
    let canon_target = match target.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("File not found: {}", e)),
    };

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    let size = match std::fs::metadata(&canon_target) {
        Ok(m) => m.len(),
        Err(e) => return IpcResponse::err(format!("Failed to get file metadata: {}", e)),
    };

    // Read file bytes and attempt UTF-8 conversion
    let bytes = match std::fs::read(&canon_target) {
        Ok(b) => b,
        Err(e) => return IpcResponse::err(format!("Failed to read file: {}", e)),
    };

    let content = match String::from_utf8(bytes) {
        Ok(c) => c,
        Err(_) => {
            // Return a structured error so the frontend can show "binary file" UI
            return IpcResponse::ok(serde_json::json!({
                "binary": true,
                "path": path,
                "size": size
            }));
        }
    };

    let rel_path = match canon_target.strip_prefix(&canon_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(_) => path.clone(),
    };

    info!("read_file: {} ({} bytes)", rel_path, size);
    IpcResponse::ok(serde_json::json!({ "content": content, "path": rel_path, "size": size }))
}

/// Get a file's content as it exists in git HEAD.
///
/// Runs `git show HEAD:<path>` in the project root.
/// For new (untracked) files, returns empty content with `isNew: true`.
/// `path` is relative to the project root.
#[tauri::command]
pub fn get_file_git_content(path: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    // Normalize path separators for git (always forward slashes)
    let git_path = path.replace('\\', "/");

    let output = match std::process::Command::new("git")
        .args(["show", &format!("HEAD:{}", git_path)])
        .current_dir(&root)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            info!("git show failed: {}", e);
            return IpcResponse::ok(serde_json::json!({
                "content": "",
                "path": path,
                "isNew": true
            }));
        }
    };

    if !output.status.success() {
        return IpcResponse::ok(serde_json::json!({
            "content": "",
            "path": path,
            "isNew": true
        }));
    }

    match String::from_utf8(output.stdout) {
        Ok(content) => IpcResponse::ok(serde_json::json!({
            "content": content,
            "path": path,
            "isNew": false
        })),
        Err(_) => IpcResponse::ok(serde_json::json!({
            "binary": true,
            "path": path
        })),
    }
}

/// Write content to a file using atomic write (temp file + rename).
///
/// `path` is relative to the project root (or the provided `root`).
/// Creates parent directories if they don't exist.
/// Returns `{ path, size }` on success.
#[tauri::command]
pub fn write_file(path: String, content: String, root: Option<String>) -> IpcResponse {
    let root = match root {
        Some(r) => PathBuf::from(r),
        None => match find_project_root() {
            Some(r) => r,
            None => return IpcResponse::err("Could not find project root"),
        },
    };

    let target = root.join(&path);

    // Security: canonicalize root and verify target will be within it.
    // For new files, canonicalize the parent directory instead.
    let canon_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Failed to resolve project root: {}", e)),
    };

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return IpcResponse::err(format!("Failed to create parent directories: {}", e));
            }
        }
    }

    // Canonicalize the parent to check path traversal (target file may not exist yet)
    let canon_parent = match target.parent().unwrap_or(&root).canonicalize() {
        Ok(p) => p,
        Err(e) => return IpcResponse::err(format!("Parent directory not found: {}", e)),
    };
    let canon_target = canon_parent.join(target.file_name().unwrap_or_default());

    if !canon_target.starts_with(&canon_root) {
        warn!(
            "Path traversal blocked: {} is outside project root {}",
            canon_target.display(),
            canon_root.display()
        );
        return IpcResponse::err("Path is outside the project root");
    }

    // Atomic write: write to temp file, then rename
    let tmp_path = canon_target.with_extension("tmp");
    if let Err(e) = std::fs::write(&tmp_path, &content) {
        return IpcResponse::err(format!("Failed to write temp file: {}", e));
    }

    if let Err(e) = std::fs::rename(&tmp_path, &canon_target) {
        // Clean up temp file on rename failure
        let _ = std::fs::remove_file(&tmp_path);
        return IpcResponse::err(format!("Failed to rename temp file: {}", e));
    }

    let rel_path = match canon_target.strip_prefix(&canon_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(_) => path.clone(),
    };

    let size = content.len();
    info!("write_file: {} ({} bytes)", rel_path, size);
    IpcResponse::ok(serde_json::json!({ "path": rel_path, "size": size }))
}
