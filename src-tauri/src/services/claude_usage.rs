//! Claude Code usage watcher — the "usage pulse" data pipe.
//!
//! Voice Mirror installs a lightweight status-line shim (`voice-mirror-mcp
//! statusline`) as Claude Code's `statusLine` command (see
//! `providers/cli/status_line.rs`). On every refresh Claude Code pipes a JSON
//! blob to that shim over stdin — model, context window, cost, lines changed,
//! worktree, and (CC v2.1.80+) the real `rate_limits`. The shim captures that
//! blob verbatim to `claude-status.json` in the app config dir.
//!
//! This service watches that file and re-emits a normalized `ai-usage` Tauri
//! event, which the frontend renders as the usage strip in the status bar. It
//! is the native, dependency-free equivalent of what claude-pulse renders in
//! the terminal — no Python, works for every user out of the box.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

use super::platform;

/// A single rate-limit window (session, weekly, or per-model).
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RateWindow {
    /// Percentage of the window consumed (0–100).
    pub used_pct: f64,
    /// When the window resets, as Unix epoch **seconds** (frontend formats it).
    pub resets_at: Option<f64>,
}

/// Normalized usage snapshot emitted to the frontend as `ai-usage`.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    /// Short model name, e.g. "Opus 4.8" (the "Claude " prefix is stripped).
    pub model: Option<String>,
    /// Context-window usage percentage (0–100).
    pub context_pct: Option<f64>,
    /// Raw context tokens used (input + output), when available.
    pub context_used: Option<u64>,
    /// Context window size in tokens, when available.
    pub context_limit: Option<u64>,
    /// Session cost in USD (Claude Code reports USD; frontend converts).
    pub cost_usd: Option<f64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub worktree_branch: Option<String>,
    /// 5-hour session limit.
    pub five_hour: Option<RateWindow>,
    /// 7-day weekly limit.
    pub seven_day: Option<RateWindow>,
    /// Per-model weekly limits (present on some plans).
    pub seven_day_opus: Option<RateWindow>,
    pub seven_day_sonnet: Option<RateWindow>,
    /// True when Claude Code supplied any rate-limit window (CC v2.1.80+).
    /// Lets the frontend gracefully hide the session/weekly bars on older CC.
    pub has_rate_limits: bool,
}

/// Path the shim writes and this service reads: `{config}/claude-status.json`.
///
/// Both the app and the standalone `voice-mirror-mcp` binary resolve this via
/// the same [`platform::get_config_dir`], so they always agree.
pub fn get_status_file_path() -> PathBuf {
    platform::get_config_dir().join("claude-status.json")
}

/// Delete any stale status snapshot from a previous session.
///
/// Called at app boot before the watcher starts, so a leftover
/// `claude-status.json` never flashes last session's usage in the status bar
/// before Claude Code's first status refresh writes a fresh one.
pub fn clear_status_file() {
    let path = get_status_file_path();
    match std::fs::remove_file(&path) {
        Ok(()) => info!("Cleared stale claude-status.json for new session"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!("Failed to clear claude-status.json: {}", e),
    }
    let _ = std::fs::remove_file(path.with_extension("json.tmp"));
}

/// Atomically persist the raw statusline JSON captured from Claude Code's stdin.
///
/// Called by the `voice-mirror-mcp statusline` shim (a separate short-lived
/// process). Best-effort: never panics, returns the IO error for logging.
pub fn write_status_json(raw: &str) -> std::io::Result<()> {
    let path = get_status_file_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Atomic write: temp file + rename, so the watcher never reads a partial
    // JSON document mid-write.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw.as_bytes())?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

fn as_f64(v: &serde_json::Value) -> Option<f64> {
    v.as_f64()
}

fn as_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
}

fn parse_window(w: Option<&serde_json::Value>) -> Option<RateWindow> {
    let w = w?;
    let used_pct = w.get("used_percentage").and_then(as_f64)?;
    let resets_at = w.get("resets_at").and_then(as_f64);
    Some(RateWindow { used_pct, resets_at })
}

/// Parse Claude Code's statusline JSON into a [`ClaudeUsage`] snapshot.
///
/// Mirrors the field mapping claude-pulse uses. Claude Code may deliver the
/// payload at the top level or wrapped under a `"data"` key; both are handled.
/// Returns `None` only when the input isn't valid JSON (e.g. an atomic write
/// caught mid-flight) — every field is otherwise optional.
pub fn parse_usage(raw: &str) -> Option<ClaudeUsage> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let root = v.get("data").unwrap_or(&v);

    let mut u = ClaudeUsage::default();

    // -- Model name: "Claude Opus 4.8" → "Opus 4.8" --
    if let Some(model) = root.get("model") {
        if let Some(dn) = model.get("display_name").and_then(|x| x.as_str()) {
            let short = dn.trim().strip_prefix("Claude ").unwrap_or(dn.trim()).trim();
            if !short.is_empty() {
                u.model = Some(short.to_string());
            }
        }
        if u.model.is_none() {
            if let Some(id) = model.get("id").and_then(|x| x.as_str()) {
                u.model = Some(id.to_string());
            }
        }
    }

    // -- Context window --
    if let Some(ctx) = root.get("context_window") {
        u.context_pct = ctx.get("used_percentage").and_then(as_f64);
        let input = ctx.get("total_input_tokens").and_then(as_u64);
        let output = ctx.get("total_output_tokens").and_then(as_u64).unwrap_or(0);
        let size = ctx.get("context_window_size").and_then(as_u64);
        if let (Some(i), Some(s)) = (input, size) {
            u.context_used = Some(i + output);
            u.context_limit = Some(s);
        }
    }

    // -- Cost + lines changed --
    if let Some(cost) = root.get("cost") {
        u.cost_usd = cost.get("total_cost_usd").and_then(as_f64);
        u.lines_added = cost.get("total_lines_added").and_then(as_u64);
        u.lines_removed = cost.get("total_lines_removed").and_then(as_u64);
    }

    // -- Worktree (branch preferred, else name) --
    if let Some(wt) = root.get("worktree") {
        let branch = wt.get("branch").and_then(|x| x.as_str());
        let name = wt.get("name").and_then(|x| x.as_str());
        u.worktree_branch = branch.or(name).filter(|s| !s.is_empty()).map(|s| s.to_string());
    }

    // -- Rate limits (CC v2.1.80+) --
    if let Some(rl) = root.get("rate_limits") {
        u.five_hour = parse_window(rl.get("five_hour"));
        u.seven_day = parse_window(rl.get("seven_day"));
        u.seven_day_opus = parse_window(rl.get("seven_day_opus"));
        u.seven_day_sonnet = parse_window(rl.get("seven_day_sonnet"));
        u.has_rate_limits = u.five_hour.is_some()
            || u.seven_day.is_some()
            || u.seven_day_opus.is_some()
            || u.seven_day_sonnet.is_some();
    }

    Some(u)
}

/// Render a compact, ASCII-safe terminal status line from the raw JSON.
///
/// Used by the shim in **standalone** mode (no pre-existing statusLine to
/// delegate to), so users without claude-pulse still get a terminal bar.
/// Separators use `|` for maximum Windows-terminal compatibility.
pub fn render_fallback_line(raw: &str) -> String {
    let Some(u) = parse_usage(raw) else {
        return String::new();
    };
    let mut parts: Vec<String> = Vec::new();
    if let Some(m) = &u.model {
        parts.push(m.clone());
    }
    if let Some(f) = &u.five_hour {
        parts.push(format!("Session {}%", f.used_pct.round() as i64));
    }
    if let Some(s) = &u.seven_day {
        parts.push(format!("Weekly {}%", s.used_pct.round() as i64));
    }
    if let Some(c) = u.context_pct {
        parts.push(format!("Ctx {}%", c.round() as i64));
    }
    if let Some(cost) = u.cost_usd {
        if cost > 0.0 {
            parts.push(format!("${:.2}", cost));
        }
    }
    if parts.is_empty() {
        return String::new();
    }
    format!("Claude | {}", parts.join(" | "))
}

/// Read the status file, parse it, and emit `ai-usage` to the frontend.
fn emit_from_file(path: &Path, app: &AppHandle) {
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                debug!("Failed to read claude-status.json: {}", e);
            }
            return;
        }
    };
    match parse_usage(&raw) {
        Some(usage) => {
            if let Err(e) = app.emit("ai-usage", &usage) {
                warn!("Failed to emit ai-usage event: {}", e);
            }
        }
        // Expected transiently if we catch an atomic write mid-flight.
        None => debug!("claude-status.json not valid JSON yet; skipping"),
    }
}

/// Handle controlling the usage watcher lifecycle (kept alive for the app's life).
pub struct UsageWatcherHandle {
    running: Arc<Mutex<bool>>,
    _watcher: Option<RecommendedWatcher>,
}

impl UsageWatcherHandle {
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn stop(&mut self) {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        *running = false;
        self._watcher = None;
        info!("Claude usage watcher stopped");
    }
}

/// Start the Claude usage watcher.
///
/// Watches the app config dir for `claude-status.json` changes and emits an
/// `ai-usage` event whenever the shim writes a fresh snapshot. Emits once at
/// startup if a snapshot already exists, so the status bar populates instantly.
pub fn start_usage_watcher(app_handle: AppHandle) -> Result<UsageWatcherHandle, String> {
    let status_path = get_status_file_path();
    let dir = status_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("Failed to create config dir for usage watcher: {}", e));
    }

    // Populate immediately from any existing snapshot.
    emit_from_file(&status_path, &app_handle);

    let running = Arc::new(Mutex::new(true));
    let running_clone = Arc::clone(&running);
    let path_clone = status_path.clone();
    let app_clone = app_handle.clone();

    // Debounce rapid change events through a channel (same pattern as the inbox
    // watcher) so a temp-write + rename pair collapses into one emit.
    let (tx, rx) = std::sync::mpsc::channel::<()>();

    let watcher_result = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
            Ok(event) => {
                if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    return;
                }
                let hit = event.paths.iter().any(|p| {
                    p.file_name()
                        .map(|f| f == "claude-status.json" || f == "claude-status.json.tmp")
                        .unwrap_or(false)
                });
                if hit {
                    let _ = tx.send(());
                }
            }
            Err(e) => error!("Claude usage watcher error: {}", e),
        }
    });

    let mut watcher =
        watcher_result.map_err(|e| format!("Failed to create usage watcher: {}", e))?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch config dir: {}", e))?;

    std::thread::Builder::new()
        .name("claude-usage-watcher".into())
        .spawn(move || {
            info!("Claude usage watcher thread started");
            loop {
                match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(()) => {
                        std::thread::sleep(std::time::Duration::from_millis(80));
                        while rx.try_recv().is_ok() {}
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if !*running_clone.lock().unwrap_or_else(|e| e.into_inner()) {
                    break;
                }
                emit_from_file(&path_clone, &app_clone);
            }
            info!("Claude usage watcher thread exited");
        })
        .map_err(|e| format!("Failed to spawn usage watcher thread: {}", e))?;

    info!("Claude usage watcher started, watching {}", status_path.display());
    Ok(UsageWatcherHandle {
        running,
        _watcher: Some(watcher),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "model": { "display_name": "Claude Opus 4.8", "id": "claude-opus-4-8" },
        "context_window": { "used_percentage": 44.2, "total_input_tokens": 100, "total_output_tokens": 50, "context_window_size": 1000000 },
        "cost": { "total_cost_usd": 1.23, "total_lines_added": 42, "total_lines_removed": 7 },
        "worktree": { "branch": "dev" },
        "rate_limits": {
            "five_hour": { "used_percentage": 61.0, "resets_at": 1751600000 },
            "seven_day": { "used_percentage": 6.0, "resets_at": 1751700000 },
            "seven_day_sonnet": { "used_percentage": 0.0 }
        }
    }"#;

    #[test]
    fn parses_model_stripping_claude_prefix() {
        let u = parse_usage(SAMPLE).unwrap();
        assert_eq!(u.model.as_deref(), Some("Opus 4.8"));
    }

    #[test]
    fn parses_context_and_cost() {
        let u = parse_usage(SAMPLE).unwrap();
        assert_eq!(u.context_pct, Some(44.2));
        assert_eq!(u.context_used, Some(150));
        assert_eq!(u.context_limit, Some(1_000_000));
        assert_eq!(u.cost_usd, Some(1.23));
        assert_eq!(u.lines_added, Some(42));
    }

    #[test]
    fn parses_rate_limit_windows() {
        let u = parse_usage(SAMPLE).unwrap();
        assert!(u.has_rate_limits);
        assert_eq!(u.five_hour.as_ref().unwrap().used_pct, 61.0);
        assert_eq!(u.five_hour.as_ref().unwrap().resets_at, Some(1751600000.0));
        assert_eq!(u.seven_day.as_ref().unwrap().used_pct, 6.0);
        // Window present but with 0% is still captured.
        assert_eq!(u.seven_day_sonnet.as_ref().unwrap().used_pct, 0.0);
        // Absent window stays None.
        assert!(u.seven_day_opus.is_none());
    }

    #[test]
    fn handles_data_wrapper() {
        let wrapped = format!(r#"{{ "data": {} }}"#, SAMPLE);
        let u = parse_usage(&wrapped).unwrap();
        assert_eq!(u.model.as_deref(), Some("Opus 4.8"));
        assert!(u.has_rate_limits);
    }

    #[test]
    fn missing_rate_limits_marks_flag_false() {
        let minimal = r#"{ "model": { "display_name": "Claude Haiku 4.5" }, "context_window": { "used_percentage": 10 } }"#;
        let u = parse_usage(minimal).unwrap();
        assert_eq!(u.model.as_deref(), Some("Haiku 4.5"));
        assert!(!u.has_rate_limits);
        assert!(u.five_hour.is_none());
    }

    #[test]
    fn invalid_json_returns_none() {
        assert!(parse_usage("{not json").is_none());
        assert!(parse_usage("").is_none());
    }

    #[test]
    fn fallback_line_is_compact_and_ordered() {
        let line = render_fallback_line(SAMPLE);
        assert!(line.starts_with("Claude | Opus 4.8"));
        assert!(line.contains("Session 61%"));
        assert!(line.contains("Weekly 6%"));
        assert!(line.contains("Ctx 44%"));
        assert!(line.contains("$1.23"));
    }

    #[test]
    fn fallback_line_empty_on_garbage() {
        assert_eq!(render_fallback_line("garbage"), "");
    }
}
