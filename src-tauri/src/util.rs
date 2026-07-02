use std::path::PathBuf;
use tracing::{info, warn};

/// Strip ANSI escape sequences from a string.
///
/// Handles CSI sequences (ESC [ ... final_byte), OSC sequences (ESC ] ... ST),
/// and simple two-byte escapes (ESC char).
pub fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next(); // consume '['
                    // CSI: consume until final byte (0x40..=0x7E)
                    while let Some(&ch) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&ch) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next(); // consume ']'
                    // OSC: consume until ST (ESC \ or BEL)
                    while let Some(ch) = chars.next() {
                        if ch == '\x07' {
                            break;
                        }
                        if ch == '\x1b' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next(); // consume single char after ESC
                }
                None => {}
            }
        } else {
            out.push(c);
        }
    }

    out
}

/// CREATE_NO_WINDOW — keep a spawned console process from flashing a console
/// window in the GUI (windows_subsystem="windows") release build.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply CREATE_NO_WINDOW to a std::process::Command on Windows (no-op elsewhere).
pub fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Truncate a string to at most `max_bytes` WITHOUT splitting a multi-byte
/// UTF-8 character.
///
/// A plain `&s[..n]` panics when byte `n` lands inside a multi-byte char
/// (e.g. emoji or non-ASCII text in a chat message), which has crashed log
/// and preview paths. This walks back to the nearest char boundary
/// (a stable-Rust `floor_char_boundary`).
pub fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

// ── Cross-process file lock ─────────────────────────────────────────────

/// Guard for a cross-process lock file. Deleting the file on drop releases
/// the lock. A guard with `path: None` means the lock could NOT be acquired
/// (we proceed unlocked after bounded retries rather than blocking forever).
pub struct FileLockGuard {
    path: Option<PathBuf>,
}

impl FileLockGuard {
    /// A guard that holds no lock (acquisition failed or was skipped).
    pub fn unlocked() -> Self {
        Self { path: None }
    }
}

impl Drop for FileLockGuard {
    fn drop(&mut self) {
        if let Some(p) = self.path.take() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Acquire a cross-process advisory lock by exclusively creating `lock_path`.
///
/// `create_new(true)` is atomic (CREATE_NEW on Windows, O_EXCL on Unix): only
/// one process can create the file. Used to serialize read-modify-write cycles
/// on shared JSON files (e.g. inbox.json, written by BOTH the Tauri app and
/// the MCP binary — without exclusion, concurrent writes lose messages).
///
/// Blocking (bounded ~2s worst case): call from sync code or wrap in
/// `spawn_blocking` from async code. A lock file older than `STALE_AFTER` is
/// treated as left over from a crashed process and broken. If the lock still
/// can't be acquired after all retries, returns an unlocked guard and logs —
/// a rare unserialized write beats wedging the messaging path.
pub fn acquire_file_lock(lock_path: &std::path::Path) -> FileLockGuard {
    const RETRIES: u32 = 50;
    const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(40);
    const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(10);

    for _ in 0..RETRIES {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(lock_path)
        {
            Ok(_file) => {
                // File handle can be dropped immediately: existence of the
                // file IS the lock; the guard deletes it on drop.
                return FileLockGuard {
                    path: Some(lock_path.to_path_buf()),
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Break a stale lock left by a crashed process.
                let stale = std::fs::metadata(lock_path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .map(|age| age > STALE_AFTER)
                    .unwrap_or(false);
                if stale {
                    warn!("Breaking stale lock file: {}", lock_path.display());
                    let _ = std::fs::remove_file(lock_path);
                    continue; // retry immediately
                }
                std::thread::sleep(RETRY_DELAY);
            }
            Err(e) => {
                // Unexpected error (missing dir, permissions) — don't spin.
                warn!(
                    "Failed to create lock file {}: {} — proceeding unlocked",
                    lock_path.display(),
                    e
                );
                return FileLockGuard::unlocked();
            }
        }
    }

    warn!(
        "Could not acquire lock {} after retries — proceeding unlocked",
        lock_path.display()
    );
    FileLockGuard::unlocked()
}

/// Escape a string for safe embedding inside a JS single-quoted string literal.
pub fn escape_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Check if a directory looks like the Voice Mirror project root.
pub fn is_project_root(path: &std::path::Path) -> bool {
    path.join("src-tauri").join("tauri.conf.json").exists()
}

/// Resolve the Voice Mirror project root directory.
///
/// Search order:
/// 1. `VOICE_MIRROR_ROOT` env var (explicit override — always wins)
/// 2. Walk up from executable path (works in dev: target/debug → project root)
/// 3. Walk up from current working directory
/// 4. Common dev path: walk up from exe looking for `package.json` with "voice-mirror"
///
/// Validates by checking for `src-tauri/tauri.conf.json`.
pub fn find_project_root() -> Option<PathBuf> {
    // 1. Explicit env var override
    if let Ok(root) = std::env::var("VOICE_MIRROR_ROOT") {
        let path = PathBuf::from(&root);
        if is_project_root(&path) {
            info!("Project root from VOICE_MIRROR_ROOT: {}", path.display());
            return Some(path);
        }
        warn!(
            "VOICE_MIRROR_ROOT={} does not contain src-tauri/tauri.conf.json",
            root
        );
    }

    // 2. Walk up from executable path (dev: target/debug/release, up to 8 levels)
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe.clone();
        for _ in 0..8 {
            if !path.pop() {
                break;
            }
            if is_project_root(&path) {
                info!("Project root from exe walk-up: {}", path.display());
                return Some(path);
            }
        }
    }

    // 3. Walk up from current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.clone();
        for _ in 0..4 {
            if is_project_root(&path) {
                info!("Project root from cwd walk-up: {}", path.display());
                return Some(path);
            }
            if !path.pop() {
                break;
            }
        }
    }

    warn!(
        "Could not find project root (src-tauri/tauri.conf.json). \
         MCP tools will NOT be available. Set VOICE_MIRROR_ROOT env var \
         or run from the project directory."
    );
    None
}
