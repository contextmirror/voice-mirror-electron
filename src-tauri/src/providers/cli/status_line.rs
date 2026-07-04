//! Status-line integration for Claude Code — Voice Mirror's native "usage pulse".
//!
//! Voice Mirror points Claude Code's `statusLine` command at its own shim
//! (`voice-mirror-mcp statusline`). On every refresh Claude Code pipes a JSON
//! blob to the shim, which captures it to `claude-status.json`; the app then
//! renders session/weekly/context/cost/model natively in the status bar (see
//! `services/claude_usage.rs`).
//!
//! **Scope: workspace-local, not global.** We write the `statusLine` into the
//! workspace's `.claude/settings.local.json` (where VM already writes MCP config
//! + trust), which Claude Code layers over the user's global `~/.claude/
//! settings.json`. This keeps VM from mutating the user's machine-wide Claude
//! config and means a moved/uninstalled VM never breaks their terminal sessions.
//!
//! Coexistence: if the user has a global status line (e.g. claude-pulse), we
//! read it and **wrap** it — our shim tees the JSON through and pipes it into
//! their renderer — so their terminal bar keeps working. An earlier VM build
//! wrote this wrap into the *global* file; on first run we detect that and
//! restore the global file to its original (un-wrapped) command.

use std::path::{Path, PathBuf};

use tracing::{info, warn};

use super::mcp_config::resolve_mcp_binary;

/// Marker that identifies the delegating form of our shim command.
const PASSTHROUGH_MARKER: &str = "statusline --passthrough | ";

/// Configure the Voice Mirror status-line shim in the workspace-local settings.
pub fn configure_status_line(project_root: &Path, cwd_override: Option<&PathBuf>) {
    // Resolve our shim binary. If it isn't built yet (dev before first
    // `cargo build --bin voice-mirror-mcp`), skip quietly.
    let mcp_bin = match resolve_mcp_binary(project_root) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(e) => {
            info!("Status-line shim: MCP binary not found ({e}); skipping status line config");
            return;
        }
    };
    // Status lines run under a POSIX shell (Git Bash on Windows); quote the path.
    let quoted_bin = format!("\"{}\"", mcp_bin);

    // Determine the delegate (the user's existing terminal status line, e.g.
    // claude-pulse) from the GLOBAL settings, restoring the global file if a
    // previous VM build had wrapped it there.
    let delegate = read_global_delegate_and_restore(&quoted_bin);

    let new_cmd = match delegate {
        Some(prev) if !prev.trim().is_empty() => {
            format!("{quoted_bin} {PASSTHROUGH_MARKER}{prev}")
        }
        _ => format!("{quoted_bin} statusline"),
    };

    // Write to the workspace-local settings — the effective Claude cwd, and the
    // project root if different (Claude discovers settings.local.json by walking
    // up from its cwd, so covering both is belt-and-suspenders).
    let mut targets: Vec<&Path> = vec![project_root];
    if let Some(cwd) = cwd_override {
        if cwd.as_path() != project_root {
            targets.push(cwd.as_path());
        }
    }
    for dir in targets {
        write_workspace_status_line(dir, &new_cmd);
    }
}

/// Extract the original (delegated) command from our wrapped shim form.
/// `"<bin>" statusline --passthrough | <original>` → `Some("<original>")`.
fn unwrap_shim(cmd: &str) -> Option<&str> {
    cmd.split_once(PASSTHROUGH_MARKER).map(|(_, rest)| rest.trim())
}

/// Read the user's global status line for use as a delegate, and — if a prior
/// VM build wrote our shim into the *global* file — restore it to the original.
///
/// Returns the command to delegate to (the user's real renderer), or `None`.
fn read_global_delegate_and_restore(quoted_bin: &str) -> Option<String> {
    let _ = quoted_bin; // reserved; matching is by marker, not exact path
    let home = dirs::home_dir()?;
    let settings_path = home.join(".claude").join("settings.json");
    if !settings_path.exists() {
        return None;
    }

    let raw = std::fs::read_to_string(&settings_path).ok()?;
    let mut settings: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let cmd = settings["statusLine"]["command"].as_str()?.to_string();
    if cmd.trim().is_empty() {
        return None;
    }

    // Case 1: global was wrapped by an older VM build → recover + restore.
    if let Some(original) = unwrap_shim(&cmd) {
        let original = original.to_string();
        settings["statusLine"]["command"] = serde_json::json!(original);
        write_settings(&settings_path, &settings, "restored global statusLine to un-wrapped form");
        return Some(original);
    }

    // Case 2: global is our *bare* shim (no delegate) from an older build →
    // remove it so the global file is clean again.
    if cmd.contains("voice-mirror-mcp") && cmd.contains("statusline") {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("statusLine");
        }
        write_settings(&settings_path, &settings, "removed VM shim from global statusLine");
        return None;
    }

    // Case 3: a genuine third-party status line (e.g. claude-pulse). Leave the
    // global file untouched and delegate to it.
    Some(cmd)
}

/// Merge a `statusLine` command into `{dir}/.claude/settings.local.json`,
/// preserving any other keys (e.g. the MCP trust settings VM writes there).
fn write_workspace_status_line(dir: &Path, command: &str) {
    let claude_dir = dir.join(".claude");
    let settings_path = claude_dir.join("settings.local.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Idempotent: skip the write if it already matches.
    if settings["statusLine"]["command"].as_str() == Some(command) {
        return;
    }

    settings["statusLine"] = serde_json::json!({
        "type": "command",
        "command": command,
    });

    if !claude_dir.exists() {
        let _ = std::fs::create_dir_all(&claude_dir);
    }
    write_settings(&settings_path, &settings, &format!("configured workspace status line at {}", settings_path.display()));
}

fn write_settings(path: &Path, settings: &serde_json::Value, success_msg: &str) {
    match serde_json::to_string_pretty(settings) {
        Ok(s) => match std::fs::write(path, &s) {
            Ok(()) => info!("{}", success_msg),
            Err(e) => warn!("Failed to write {}: {}", path.display(), e),
        },
        Err(e) => warn!("Failed to serialize settings for {}: {}", path.display(), e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_recovers_the_delegated_command() {
        let wrapped = r#""C:/vm/voice-mirror-mcp.exe" statusline --passthrough | COLUMNS=200 python C:/cp/claude_status.py"#;
        assert_eq!(
            unwrap_shim(wrapped),
            Some("COLUMNS=200 python C:/cp/claude_status.py")
        );
    }

    #[test]
    fn unwrap_returns_none_for_a_plain_command() {
        assert_eq!(unwrap_shim("COLUMNS=200 python claude_status.py"), None);
        assert_eq!(unwrap_shim(r#""bin" statusline"#), None);
    }
}
