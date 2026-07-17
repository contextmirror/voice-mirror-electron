#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Standalone MCP server binary for Voice Mirror.
//!
//! This binary is spawned by Claude Code as an MCP tool server. It communicates:
//! - With Claude Code via **stdio** (JSON-RPC 2.0)
//! - With the Tauri app via **named pipe** (length-prefixed JSON) for fast IPC
//!
//! Environment variables:
//! - `VOICE_MIRROR_DATA_DIR` — path to the MCP data directory (inbox.json, status.json, etc.)
//! - `VOICE_MIRROR_PIPE` — named pipe path for fast IPC (optional; falls back to file-based)
//! - `ENABLED_GROUPS` — comma-separated tool groups to load on startup

use std::path::PathBuf;

use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use voice_mirror_lib::ipc::pipe_client;
use voice_mirror_lib::mcp::pipe_router::PipeRouter;
use voice_mirror_lib::mcp::server::run_server;
use voice_mirror_lib::services::output::{self, FileLayer};

#[tokio::main]
async fn main() {
    // ── Status-line shim fast path ──────────────────────────────────────────
    // Claude Code invokes `voice-mirror-mcp statusline` as its `statusLine`
    // command and pipes a JSON blob (model, context, cost, rate limits) on
    // stdin. We capture that blob for the app's usage watcher and exit
    // immediately — no logging, no MCP server, no pipe. This branch MUST stay
    // first so the heavyweight paths below never run on a status refresh.
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("statusline") {
            run_statusline_shim(args.get(2).map(String::as_str));
            return;
        }
    }

    // Logging goes to TWO sinks:
    // - stderr (stdout is reserved for JSON-RPC; Claude Code captures stderr)
    // - a JSONL file under the shared log dir, so failures/panics are persisted
    //   where the app's diagnostics export (and a connected Claude) can read
    //   them instead of vanishing when this separate process dies.
    let log_path = output::mcp_server_log_path();
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(FileLayer::new(log_path.clone()))
        .init();

    // Persist panics to the log file before the process unwinds — stderr alone
    // is captured only by Claude Code, so without this a crash leaves no trace
    // Voice Mirror can surface. Chain to the default hook so behavior is
    // otherwise unchanged.
    let default_hook = std::panic::take_hook();
    let panic_log_path = log_path.clone();
    std::panic::set_hook(Box::new(move |info| {
        output::append_log_line(&panic_log_path, "ERROR", &format!("PANIC: {}", info));
        default_hook(info);
    }));

    tracing::info!("MCP server starting; logging to {}", log_path.display());

    // Resolve data directory
    let data_dir = std::env::var("VOICE_MIRROR_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_data_dir());

    // Try to connect to the named pipe for fast IPC.
    // If connected, wrap in PipeRouter which runs a background dispatch loop
    // to route BrowserResponse and UserMessage to different channels.
    let pipe_name = std::env::var("VOICE_MIRROR_PIPE").ok();
    let router = if let Some(ref name) = pipe_name {
        match pipe_client::connect_to_pipe(name, 10).await {
            Ok(client) => {
                eprintln!("[MCP] Connected to pipe: {}", name);
                let router = PipeRouter::new(client);
                router.start_dispatch();
                Some(router)
            }
            Err(e) => {
                eprintln!("[MCP] Pipe connection failed: {}. Falling back to file IPC.", e);
                None
            }
        }
    } else {
        eprintln!("[MCP] No VOICE_MIRROR_PIPE env var — using file-based IPC.");
        None
    };

    // Read enabled groups from env (set by Tauri app via .mcp.json / settings.json)
    let enabled_groups = std::env::var("ENABLED_GROUPS").ok();

    // Run the MCP server (blocks until stdin closes)
    if let Err(e) = run_server(data_dir, router, enabled_groups).await {
        eprintln!("[MCP] Server error: {}", e);
        std::process::exit(1);
    }
}

/// Status-line shim: capture Claude Code's stdin JSON and render a terminal line.
///
/// - Always writes the raw JSON to `claude-status.json` (best-effort) so the
///   app's usage watcher can surface it natively in the status bar.
/// - `--passthrough` mode echoes the JSON verbatim so a downstream renderer
///   (e.g. the user's existing claude-pulse) can consume it via a shell pipe,
///   leaving their terminal bar untouched.
/// - Standalone mode prints our own compact line, so users **without**
///   claude-pulse still get a terminal status bar.
fn run_statusline_shim(mode: Option<&str>) {
    use std::io::{Read, Write};

    let mut raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut raw);

    // Best-effort capture for the app; never fail the status line over this.
    let _ = voice_mirror_lib::services::claude_usage::write_status_json(&raw);

    let out = if mode == Some("--passthrough") {
        raw
    } else {
        voice_mirror_lib::services::claude_usage::render_fallback_line(&raw)
    };

    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = lock.write_all(out.as_bytes());
    let _ = lock.flush();
}

/// Default data directory (matches the Tauri app's data directory).
fn default_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-mirror")
        .join("data")
}
