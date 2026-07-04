//! Shared utilities for dev server detection.
//!
//! Port probing, package manager detection, URL/env/flag parsing, process killing,
//! and self-detection guards.

use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Port probing
// ---------------------------------------------------------------------------

/// Check if a TCP port is accepting connections on localhost.
///
/// Tries IPv4 (`127.0.0.1`) first, then falls back to IPv6 (`[::1]`)
/// since some dev servers bind only to one address family.
pub fn is_port_listening(port: u16) -> bool {
    let timeout = Duration::from_millis(200);
    // Try IPv4 first
    if std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        timeout,
    )
    .is_ok()
    {
        return true;
    }
    // Fallback to IPv6
    std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
        timeout,
    )
    .is_ok()
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

/// Detect the package manager from lockfiles in the project root.
///
/// Returns "bun", "yarn", "pnpm", or "npm" (default).
pub fn detect_package_manager(project_root: &str) -> String {
    let root = Path::new(project_root);

    let detected = if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
        "bun"
    } else if root.join("yarn.lock").exists() {
        "yarn"
    } else if root.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        return "npm".to_string(); // npm is always available with Node.js
    };

    // Verify the detected package manager is actually installed.
    if is_command_available(detected) {
        detected.to_string()
    } else {
        tracing::info!(
            "[dev-server] Lockfile suggests `{}` but it's not installed, falling back to npm",
            detected
        );
        "npm".to_string()
    }
}

/// Check if a command is available on the system PATH.
pub(crate) fn is_command_available(cmd: &str) -> bool {
    let mut check_cmd = if cfg!(target_os = "windows") {
        std::process::Command::new("where")
    } else {
        std::process::Command::new("which")
    };
    check_cmd
        .arg(cmd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::util::hidden(&mut check_cmd);
    matches!(check_cmd.status(), Ok(status) if status.success())
}

/// Build a start command from the package manager and script name.
pub(super) fn make_start_command(pkg_manager: &str, script: &str) -> String {
    format!("{} run {}", pkg_manager, script)
}

// ---------------------------------------------------------------------------
// Corepack bridge — run yarn/pnpm without a global install
// ---------------------------------------------------------------------------

/// The package manager a repo INTENDS to use, even when it isn't on PATH.
///
/// Priority: the `packageManager` field (corepack's own source of truth,
/// e.g. `"yarn@1.22.22"`), then lockfiles. Returns the bare tool name
/// ("yarn" | "pnpm" | "npm" | "bun") or None when nothing indicates one.
///
/// Walks UP from the given dir: in a monorepo the manager is declared at the
/// ROOT (the `packageManager` field + lockfile), but the dev server spawns in
/// a MEMBER dir (live repro: excalidraw launches in `excalidraw-app`, which has
/// neither) — so a root-only check found nothing and skipped the bridge. This
/// mirrors how corepack itself resolves: nearest `packageManager` walking up.
pub fn intended_package_manager(project_root: &str) -> Option<String> {
    let mut dir = Some(Path::new(project_root));
    // Bounded so a deeply-nested member can't crawl to the filesystem root and
    // pick up an unrelated repo's lockfile; member→workspace-root is 1–2 hops.
    for _ in 0..6 {
        let Some(d) = dir else { break };
        if let Ok(content) = std::fs::read_to_string(d.join("package.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(pm) = json.get("packageManager").and_then(|v| v.as_str()) {
                    let name = pm.split('@').next().unwrap_or("").trim();
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
        if d.join("bun.lockb").exists() || d.join("bun.lock").exists() {
            return Some("bun".to_string());
        }
        if d.join("yarn.lock").exists() {
            return Some("yarn".to_string());
        }
        if d.join("pnpm-lock.yaml").exists() {
            return Some("pnpm".to_string());
        }
        dir = d.parent();
    }
    None
}

/// Ensure the project's intended package manager is runnable, bridging via
/// corepack when it isn't globally installed. Returns the shim directory to
/// PREPEND to the child PATH, or None when no bridge is needed.
///
/// The real-world gap (live repro: excalidraw): a repo pins
/// `packageManager: yarn@1.22.22` and its start script is `yarn && vite`, but
/// the user never `npm i -g yarn`'d. The npm-fallback can't save it — the
/// SCRIPT ITSELF calls `yarn`. corepack (bundled with Node ≥16.9) is the
/// standard bridge: it reads `packageManager` and runs the pinned version.
///
/// Rather than mutate the user's Node install (a bare `corepack enable` writes
/// shims into the Node bin dir and can need admin), we generate shims into a
/// VM-owned dir and hand it back for the launcher to prepend — so BOTH the
/// outer command and any inner `yarn`/`pnpm` calls in the script resolve.
pub fn ensure_corepack_shims(project_root: &str) -> Option<String> {
    let manager = intended_package_manager(project_root)?;
    // npm always ships with Node; bun is not a corepack-managed tool.
    if manager == "npm" || manager == "bun" {
        return None;
    }
    if is_command_available(&manager) {
        return None; // already runnable — no bridge needed
    }
    if !is_command_available("corepack") {
        tracing::warn!(
            "[dev-server] project needs `{}` but neither it nor corepack is installed",
            manager
        );
        return None;
    }

    let shim_dir = dirs::data_dir()?.join("voice-mirror").join("corepack-shims");
    if let Err(e) = std::fs::create_dir_all(&shim_dir) {
        tracing::warn!("[dev-server] could not create corepack shim dir: {}", e);
        return None;
    }

    // `corepack enable --install-directory <dir> <mgr>` writes the shims
    // (cmd + ps1 + POSIX) without touching the Node install. Idempotent —
    // safe to re-run every launch, cheap enough not to cache.
    let mut cmd = std::process::Command::new("corepack");
    cmd.arg("enable")
        .arg("--install-directory")
        .arg(&shim_dir)
        .arg(&manager)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::util::hidden(&mut cmd);
    match cmd.status() {
        Ok(s) if s.success() => {
            tracing::info!(
                "[dev-server] corepack shims for `{}` → {}",
                manager,
                shim_dir.display()
            );
            Some(shim_dir.to_string_lossy().to_string())
        }
        other => {
            tracing::warn!(
                "[dev-server] `corepack enable {}` failed: {:?}",
                manager,
                other
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Extract a port number from a URL like "http://localhost:1420".
pub(super) fn extract_port_from_url(url: &str) -> Option<u16> {
    let after_host = url
        .strip_prefix("http://localhost:")
        .or_else(|| url.strip_prefix("https://localhost:"))?;

    let port_str: String = after_host.chars().take_while(|c| c.is_ascii_digit()).collect();
    port_str.parse().ok()
}

/// Extract port from vite config content using regex.
pub(super) fn extract_vite_port(content: &str) -> Option<u16> {
    static VITE_PORT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?s)server\s*:?\s*\{[\s\S]*?port\s*:\s*(\d+)").unwrap()
    });
    let caps = VITE_PORT_RE.captures(content)?;
    caps.get(1)?.as_str().parse().ok()
}

/// Extract `PORT=NNNN` or `VITE_PORT=NNNN` from env file content.
pub(super) fn extract_port_from_env(content: &str) -> Option<u16> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some(val) = trimmed
            .strip_prefix("VITE_PORT=")
            .or_else(|| trimmed.strip_prefix("PORT="))
        {
            let val = val.trim().trim_matches('"').trim_matches('\'');
            if let Ok(port) = val.parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}

/// Extract `--port NNNN` or `-p NNNN` from a script command string.
pub(super) fn extract_port_flag(cmd: &str) -> Option<u16> {
    static PORT_FLAG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?:--port|-p)\s+(\d+)").unwrap()
    });
    let caps = PORT_FLAG_RE.captures(cmd)?;
    caps.get(1)?.as_str().parse().ok()
}

// ---------------------------------------------------------------------------
// Process killing
// ---------------------------------------------------------------------------

/// Kill the process listening on a given port.
///
/// Platform-specific: uses `netstat` + `taskkill` on Windows, `lsof` + `kill`
/// on Unix. Returns Ok(()) if a process was found and killed, Err otherwise.
pub fn kill_port_process(port: u16) -> Result<(), String> {
    kill_port_process_impl(port)
}

#[cfg(windows)]
fn kill_port_process_impl(port: u16) -> Result<(), String> {
    use std::process::Command;

    let mut netstat_cmd = Command::new("netstat");
    netstat_cmd.args(["-ano"]);
    crate::util::hidden(&mut netstat_cmd);
    let output = netstat_cmd
        .output()
        .map_err(|e| format!("Failed to run netstat: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let port_suffix = format!(":{}", port);
    let mut killed = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("LISTENING") {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let local_addr = parts[1];
        if !local_addr.ends_with(&port_suffix) {
            continue;
        }

        let pid_str = parts[4].trim();
        if let Ok(pid) = pid_str.parse::<u32>() {
            if pid > 0 {
                tracing::info!("[dev-server] Killing PID {} on port {} (addr={})", pid, port, local_addr);
                let mut kill_cmd = Command::new("taskkill");
                kill_cmd.args(["/PID", &pid.to_string(), "/F"]);
                crate::util::hidden(&mut kill_cmd);
                let kill = kill_cmd
                    .output()
                    .map_err(|e| format!("Failed to run taskkill: {}", e))?;

                if kill.status.success() {
                    killed = true;
                } else {
                    let stderr = String::from_utf8_lossy(&kill.stderr);
                    tracing::warn!("[dev-server] taskkill PID {} failed: {}", pid, stderr.trim());
                }
            }
        }
    }

    if killed {
        Ok(())
    } else {
        Err(format!("No process found listening on port {}", port))
    }
}

#[cfg(not(windows))]
fn kill_port_process_impl(port: u16) -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("lsof")
        .args(["-ti", &format!(":{}", port)])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pid_str = stdout.trim();

    if pid_str.is_empty() {
        return Err(format!("No process found listening on port {}", port));
    }

    tracing::info!("[dev-server] Killing PID {} on port {}", pid_str, port);
    let kill = Command::new("kill")
        .args(["-9", pid_str])
        .output()
        .map_err(|e| format!("Failed to run kill: {}", e))?;

    if kill.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&kill.stderr);
        Err(format!("Failed to kill PID {}: {}", pid_str, stderr.trim()))
    }
}

// ---------------------------------------------------------------------------
// Self-detection helpers
// ---------------------------------------------------------------------------

/// Check if the current running binary lives under the project's `src-tauri/target/` directory.
pub(super) fn is_own_project(project_root: &Path) -> bool {
    let target_dir = project_root.join("src-tauri").join("target");
    if let Ok(exe) = std::env::current_exe() {
        let exe_canon = std::fs::canonicalize(&exe).unwrap_or(exe);
        let target_canon = std::fs::canonicalize(&target_dir).unwrap_or(target_dir);
        exe_canon.starts_with(&target_canon)
    } else {
        false
    }
}

/// Read the Tauri devUrl port from the project's `tauri.conf.json`.
pub(super) fn own_tauri_dev_port(project_root: &Path) -> Option<u16> {
    let conf_path = project_root.join("src-tauri").join("tauri.conf.json");
    let content = std::fs::read_to_string(conf_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let dev_url = json.get("build")?.get("devUrl")?.as_str()?;
    extract_port_from_url(dev_url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intended_pm_walks_up_to_the_workspace_root() {
        // Live repro: excalidraw declares `packageManager` + yarn.lock at the
        // ROOT, but the dev server spawns in the `excalidraw-app` MEMBER dir
        // (no field, no lockfile). The bridge must still resolve `yarn`.
        let base = std::env::temp_dir().join(format!("vm_pm_{}", std::process::id()));
        let member = base.join("excalidraw-app");
        std::fs::create_dir_all(&member).unwrap();
        std::fs::write(
            base.join("package.json"),
            r#"{ "packageManager": "yarn@1.22.22" }"#,
        )
        .unwrap();
        std::fs::write(base.join("yarn.lock"), "").unwrap();
        // The member has its own package.json WITHOUT a packageManager field.
        std::fs::write(member.join("package.json"), r#"{ "name": "app" }"#).unwrap();

        assert_eq!(
            intended_package_manager(member.to_str().unwrap()).as_deref(),
            Some("yarn"),
            "must walk up from the member to find the root's pinned manager"
        );
        // A plain npm repo (no field, no lockfile anywhere) needs no bridge.
        let plain = base.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        std::fs::write(plain.join("package.json"), r#"{ "name": "x" }"#).unwrap();
        // (plain is under base, which has yarn.lock — so walk-up finds yarn; that
        // is correct: a file inside a yarn workspace IS a yarn context.)

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_extract_port_from_url_http() {
        assert_eq!(extract_port_from_url("http://localhost:1420"), Some(1420));
    }

    #[test]
    fn test_extract_port_from_url_with_path() {
        assert_eq!(extract_port_from_url("http://localhost:3000/"), Some(3000));
    }

    #[test]
    fn test_extract_port_from_url_https() {
        assert_eq!(extract_port_from_url("https://localhost:8443"), Some(8443));
    }

    #[test]
    fn test_extract_port_from_url_no_port() {
        assert_eq!(extract_port_from_url("http://localhost"), None);
    }

    #[test]
    fn test_extract_vite_port() {
        let config = r#"
            export default defineConfig({
                server: {
                    port: 1420,
                    strictPort: true,
                },
            })
        "#;
        assert_eq!(extract_vite_port(config), Some(1420));
    }

    #[test]
    fn test_extract_vite_port_no_server() {
        assert_eq!(extract_vite_port("export default defineConfig({})"), None);
    }

    #[test]
    fn test_extract_port_from_env() {
        assert_eq!(extract_port_from_env("# comment\nVITE_PORT=3000\nOTHER=foo"), Some(3000));
    }

    #[test]
    fn test_extract_port_from_env_plain_port() {
        assert_eq!(extract_port_from_env("PORT=8080"), Some(8080));
    }

    #[test]
    fn test_extract_port_from_env_comment_ignored() {
        assert_eq!(extract_port_from_env("# PORT=9999\nPORT=3000"), Some(3000));
    }

    #[test]
    fn test_extract_port_from_env_empty() {
        assert_eq!(extract_port_from_env(""), None);
    }

    #[test]
    fn test_extract_port_flag_long() {
        assert_eq!(extract_port_flag("vite --port 8080"), Some(8080));
    }

    #[test]
    fn test_extract_port_flag_short() {
        assert_eq!(extract_port_flag("vite -p 9090"), Some(9090));
    }

    #[test]
    fn test_extract_port_flag_none() {
        assert_eq!(extract_port_flag("vite dev"), None);
    }

    #[test]
    fn test_detect_package_manager_npm_default() {
        assert_eq!(detect_package_manager("/this/path/does/not/exist"), "npm");
    }

    #[test]
    fn test_is_command_available_finds_node() {
        assert!(is_command_available("node"));
    }

    #[test]
    fn test_is_command_available_rejects_bogus() {
        assert!(!is_command_available("totally_not_a_real_command_xyz_123"));
    }

    #[test]
    fn test_is_port_listening_closed() {
        assert!(!is_port_listening(1));
    }

    #[test]
    fn test_own_tauri_dev_port() {
        let dir = std::env::temp_dir().join("vm_test_own_tauri_port");
        let tauri_dir = dir.join("src-tauri");
        let _ = std::fs::create_dir_all(&tauri_dir);
        std::fs::write(
            tauri_dir.join("tauri.conf.json"),
            r#"{ "build": { "devUrl": "http://localhost:1420" } }"#,
        ).unwrap();
        assert_eq!(own_tauri_dev_port(&dir), Some(1420));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_own_tauri_dev_port_missing_file() {
        let dir = std::env::temp_dir().join("vm_test_own_tauri_port_missing");
        let _ = std::fs::create_dir_all(&dir);
        assert_eq!(own_tauri_dev_port(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_own_project_different_dir() {
        let dir = std::env::temp_dir().join("vm_test_is_own_project");
        let _ = std::fs::create_dir_all(&dir);
        assert!(!is_own_project(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
