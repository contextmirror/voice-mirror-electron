//! Dev server detection engine.
//!
//! Scans a project directory for common dev server configurations (Vite, Next.js,
//! CRA, Angular, SvelteKit, Tauri, Python frameworks) and probes whether the
//! detected port is active.
//!
//! Split into sub-modules by ecosystem:
//! - `node` — Node.js/JS framework detection (package.json, vite config, etc.)
//! - `python` — Python framework detection (requirements.txt, pyproject.toml, etc.)
//! - `workspace` — monorepo member scan (workspaces globs, apps/*, pnpm-workspace)
//! - `util` — Shared helpers (port probing, package manager, parsing)

mod node;
mod python;
mod workspace;
pub(crate) mod util;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use util::{detect_package_manager, is_port_listening, kill_port_process};

/// A detected dev server configuration from project files.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDevServer {
    /// Framework name (e.g. "Vite", "Next.js", "Tauri")
    pub framework: String,
    /// Port number the server listens on
    pub port: u16,
    /// Full URL (e.g. "http://localhost:1420")
    pub url: String,
    /// Command to start the dev server (e.g. "npm run dev")
    pub start_command: String,
    /// Config file that sourced this detection (e.g. "tauri.conf.json")
    pub source: String,
    /// Whether the port is currently accepting connections
    pub running: bool,
    /// Whether the project environment needs to be set up before the server can start
    #[serde(default)]
    pub needs_setup: bool,
    /// Commands to run to set up the environment (e.g. ["python -m venv .venv", "pip install -r requirements.txt"])
    #[serde(default)]
    pub setup_commands: Vec<String>,
    /// Directory to spawn the dev server in when it is NOT the scanned root —
    /// set for monorepo workspace members (e.g. `<root>/apps/docs`). `None`
    /// means the scanned project root itself.
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Scan a project directory and return all detected dev servers.
///
/// Detection priority:
/// 1. `tauri.conf.json` — exact devUrl
/// 2. `vite.config.js` / `vite.config.ts` — regex for port
/// 3. `.env` / `.env.local` — PORT or VITE_PORT
/// 4. `package.json` scripts — pattern matching
/// 5. Python project — requirements.txt / pyproject.toml / Pipfile
pub fn detect_dev_servers(project_root: &str) -> Vec<DetectedDevServer> {
    let root = Path::new(project_root);
    let pkg_manager = detect_package_manager(project_root);
    let mut servers: Vec<DetectedDevServer> = Vec::new();
    let mut seen_ports: std::collections::HashSet<u16> = std::collections::HashSet::new();

    // 1. tauri.conf.json
    if let Some(server) = node::detect_from_tauri_conf(root, &pkg_manager) {
        // Port 0 = "no dev server" (static-frontend Tauri app) — it must never
        // participate in port dedupe (two such apps would shadow each other).
        if server.port != 0 {
            seen_ports.insert(server.port);
        }
        servers.push(server);
    }

    // 2. vite.config.js / vite.config.ts
    if let Some(server) = node::detect_from_vite_config(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // 3. .env / .env.local
    for env_file in &[".env", ".env.local"] {
        if let Some(server) = node::detect_from_env(root, env_file, &pkg_manager) {
            if seen_ports.insert(server.port) {
                servers.push(server);
            }
        }
    }

    // 4. package.json scripts
    for server in node::detect_from_package_json(root, &pkg_manager) {
        if seen_ports.insert(server.port) {
            servers.push(server);
        }
    }

    // 5. Python project detection
    for server in python::detect_python_servers(root, &mut seen_ports) {
        servers.push(server);
    }

    // 6. Monorepo workspace members (apps/*, workspaces globs, pnpm-workspace).
    // Root-level results stay first, so launch-target preference ("Tauri, else
    // first detected") favors the root app when one exists. The root's package
    // manager is reused — member dirs don't carry their own lockfiles.
    for server in workspace::detect_workspace_servers(root, &pkg_manager, &mut seen_ports) {
        servers.push(server);
    }

    // 7. Custom-launcher Tauri apps (bespoke monorepos): a tauri.conf.json lives
    // somewhere non-standard and the app is launched by the project's OWN root
    // dev/start script (yaak: `npm start` → node run-dev.mjs → tauri dev). Only
    // when nothing standard already found a Tauri app, so conventional apps are
    // untouched.
    if !servers.iter().any(|s| s.framework.eq_ignore_ascii_case("tauri")) {
        if let Some(server) = node::detect_tauri_via_custom_launcher(root, &pkg_manager) {
            // This is the app's OWN launcher — the authoritative, preferred way
            // to run it. Drop any workspace-member frontend entry that already
            // claimed the same dev port (it's the SAME app's frontend; running
            // the Tauri launcher runs that frontend natively), so the launch
            // target isn't the bare frontend on a dedup race.
            if server.port != 0 {
                servers.retain(|s| s.port != server.port);
            }
            servers.push(server);
        }
    }

    // Probe all ports
    for server in &mut servers {
        server.running = is_port_listening(server.port);
    }

    // Self-detection guard: when scanning our own project root, exclude the
    // Tauri dev server entry. During `tauri dev`, Voice Mirror's own Vite
    // dev server on port 31420 is always running — reporting it as a detected
    // "external" dev server is misleading.
    if util::is_own_project(root) {
        if let Some(own_port) = util::own_tauri_dev_port(root) {
            servers.retain(|s| s.port != own_port);
        }
    }

    servers
}
