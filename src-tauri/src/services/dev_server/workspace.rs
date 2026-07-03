//! Monorepo / workspace-member detection.
//!
//! Root-only detection misses every monorepo: the launchable app lives in
//! `apps/<name>` (Turborepo/Nx), a `workspaces` glob (npm/yarn/bun), or a
//! `pnpm-workspace.yaml` package dir — the workspace ROOT has no dev server of
//! its own, so `sandbox_start` refused with "no dev server detected" (live
//! repro: `tauri-ui`, whose only runnable app is `apps/docs`, a Next.js site).
//!
//! This module expands the workspace-member globs (plus common conventional
//! dirs as a fallback), runs the SAME per-ecosystem detectors inside each
//! member, and tags results with the member's absolute path (`cwd`) so the
//! launcher spawns the dev server in the right directory.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::{node, python, DetectedDevServer};

/// Upper bound on member directories scanned — a runaway glob in a huge repo
/// must not turn detection into a filesystem crawl.
const MAX_MEMBER_DIRS: usize = 32;

/// Directories that are never workspace members.
const SKIP_DIRS: [&str; 6] = ["node_modules", ".git", "dist", "build", "target", ".next"];

/// Collect workspace-member glob patterns declared by the repo, in priority
/// order: package.json `workspaces` (array or `{ packages: [...] }`), then
/// `pnpm-workspace.yaml` `packages:` entries.
fn declared_member_globs(root: &Path) -> Vec<String> {
    let mut globs: Vec<String> = Vec::new();

    // package.json "workspaces": ["apps/*", "packages/*"] or { packages: [...] }
    if let Ok(content) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let ws = json.get("workspaces");
            let arr = ws
                .and_then(|w| w.as_array())
                .or_else(|| ws.and_then(|w| w.get("packages")).and_then(|p| p.as_array()));
            if let Some(arr) = arr {
                globs.extend(arr.iter().filter_map(|v| v.as_str()).map(String::from));
            }
        }
    }

    // pnpm-workspace.yaml — light line-based parse of the `packages:` list
    // (entries look like `  - "apps/*"` / `  - packages/*`).
    if let Ok(content) = std::fs::read_to_string(root.join("pnpm-workspace.yaml")) {
        let mut in_packages = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("packages:") {
                in_packages = true;
                continue;
            }
            if in_packages {
                if let Some(item) = trimmed.strip_prefix("- ") {
                    globs.push(item.trim_matches(|c| c == '"' || c == '\'').to_string());
                } else if !trimmed.is_empty() && !trimmed.starts_with('#') {
                    in_packages = false; // left the list
                }
            }
        }
    }

    globs
}

/// Expand one member glob relative to `root`. Supports the two shapes real
/// workspace files use: a literal dir (`apps/desktop`) and a single trailing
/// star (`apps/*`). Exclusion globs (`!...`) and deeper patterns are skipped.
fn expand_glob(root: &Path, pattern: &str) -> Vec<PathBuf> {
    let pattern = pattern.trim().trim_end_matches('/');
    if pattern.is_empty() || pattern.starts_with('!') {
        return Vec::new();
    }

    if let Some(base) = pattern.strip_suffix("/*") {
        // `apps/*` → every non-hidden subdirectory of `apps`
        let base_dir = root.join(base);
        let Ok(entries) = std::fs::read_dir(&base_dir) else {
            return Vec::new();
        };
        entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| !n.starts_with('.') && !SKIP_DIRS.contains(&n))
                    .unwrap_or(false)
            })
            .collect()
    } else if !pattern.contains('*') {
        // Literal member dir
        let dir = root.join(pattern);
        if dir.is_dir() { vec![dir] } else { Vec::new() }
    } else {
        Vec::new() // deeper glob shapes (`**`, mid-path stars) — not worth emulating
    }
}

/// The member directories to scan: declared workspace globs, else (for repos
/// with no workspace manifest) the conventional monorepo dirs that exist.
fn member_dirs(root: &Path) -> Vec<PathBuf> {
    let mut globs = declared_member_globs(root);
    if globs.is_empty() {
        for conventional in ["apps/*", "packages/*", "examples/*"] {
            // Only fall back where the base dir actually exists.
            let base = conventional.trim_end_matches("/*");
            if root.join(base).is_dir() {
                globs.push(conventional.to_string());
            }
        }
    }

    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for g in globs {
        for dir in expand_glob(root, &g) {
            if dirs.len() >= MAX_MEMBER_DIRS {
                tracing::debug!(
                    "[dev-server] workspace scan capped at {} member dirs",
                    MAX_MEMBER_DIRS
                );
                return dirs;
            }
            if seen.insert(dir.clone()) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// Run the standard detectors inside each workspace member and return servers
/// tagged with the member's `cwd` (spawn directory) + a member-relative
/// `source`. `pkg_manager` is the ROOT's manager — lockfiles live at the
/// monorepo root, so per-member detection would wrongly fall back to npm.
pub(super) fn detect_workspace_servers(
    root: &Path,
    pkg_manager: &str,
    seen_ports: &mut HashSet<u16>,
) -> Vec<DetectedDevServer> {
    let mut servers: Vec<DetectedDevServer> = Vec::new();

    for dir in member_dirs(root) {
        let rel = dir
            .strip_prefix(root)
            .unwrap_or(&dir)
            .to_string_lossy()
            .replace('\\', "/");

        let mut member_servers: Vec<DetectedDevServer> = Vec::new();
        if let Some(s) = node::detect_from_tauri_conf(&dir, pkg_manager) {
            member_servers.push(s);
        }
        if let Some(s) = node::detect_from_vite_config(&dir, pkg_manager) {
            member_servers.push(s);
        }
        for env_file in &[".env", ".env.local"] {
            if let Some(s) = node::detect_from_env(&dir, env_file, pkg_manager) {
                member_servers.push(s);
            }
        }
        member_servers.extend(node::detect_from_package_json(&dir, pkg_manager));
        {
            // Python members share the port-dedupe set so a FastAPI member
            // doesn't double-report against a node member on the same port.
            let mut member_seen = seen_ports.clone();
            member_servers.extend(python::detect_python_servers(&dir, &mut member_seen));
        }

        for mut s in member_servers {
            // Port 0 = "no dev server" (static-frontend Tauri) — never deduped.
            if s.port != 0 && !seen_ports.insert(s.port) {
                continue; // a root-level or earlier member already owns this port
            }
            s.cwd = Some(dir.to_string_lossy().to_string());
            s.source = format!("{}/{}", rel, s.source);
            tracing::info!(
                "[dev-server]   workspace member {}: {} :{} ({})",
                rel,
                s.framework,
                s.port,
                s.source
            );
            servers.push(s);
        }
    }

    servers
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vm_ws_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn expands_declared_npm_workspaces() {
        let root = temp_root("npmws");
        write(
            &root.join("package.json"),
            r#"{ "workspaces": ["apps/*", "tools/site"] }"#,
        );
        write(
            &root.join("apps/web/package.json"),
            r#"{ "scripts": { "dev": "vite --port 5199" } }"#,
        );
        write(
            &root.join("tools/site/package.json"),
            r#"{ "scripts": { "dev": "next dev -p 3199" } }"#,
        );

        let mut seen = HashSet::new();
        let servers = detect_workspace_servers(&root, "npm", &mut seen);
        assert_eq!(servers.len(), 2, "both members should be found: {:?}", servers);
        assert!(servers.iter().all(|s| s.cwd.is_some()));
        assert!(servers.iter().any(|s| s.source.starts_with("apps/web/")));
        assert!(servers.iter().any(|s| s.source.starts_with("tools/site/")));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn falls_back_to_conventional_dirs_without_manifest() {
        let root = temp_root("conv");
        // No workspaces declaration at all — a Turborepo-style layout.
        write(&root.join("package.json"), r#"{ "scripts": { "dev": "turbo dev" } }"#);
        write(
            &root.join("apps/docs/package.json"),
            r#"{ "scripts": { "dev": "next dev -p 3123" } }"#,
        );

        let mut seen = HashSet::new();
        let servers = detect_workspace_servers(&root, "bun", &mut seen);
        assert_eq!(servers.len(), 1, "{:?}", servers);
        assert_eq!(servers[0].cwd.as_deref(), Some(root.join("apps/docs").to_string_lossy().as_ref()));
        // Root pkg manager is used for the member's start command.
        assert!(servers[0].start_command.starts_with("bun "), "{}", servers[0].start_command);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dedupes_against_root_ports_and_skips_junk_dirs() {
        let root = temp_root("dedupe");
        write(&root.join("package.json"), r#"{ "workspaces": ["apps/*"] }"#);
        write(
            &root.join("apps/web/package.json"),
            r#"{ "scripts": { "dev": "vite --port 5199" } }"#,
        );
        // node_modules must never be treated as a member even under a glob base.
        write(
            &root.join("apps/node_modules/package.json"),
            r#"{ "scripts": { "dev": "vite --port 5999" } }"#,
        );

        let mut seen = HashSet::new();
        seen.insert(5199); // pretend the root already claimed this port
        let servers = detect_workspace_servers(&root, "npm", &mut seen);
        assert!(
            servers.iter().all(|s| s.port != 5199),
            "root-claimed port must be deduped: {:?}",
            servers
        );
        assert!(
            servers.iter().all(|s| !s.source.contains("node_modules")),
            "node_modules must be skipped: {:?}",
            servers
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pnpm_workspace_yaml_globs_are_parsed() {
        let root = temp_root("pnpmws");
        write(&root.join("pnpm-workspace.yaml"), "packages:\n  - \"web/*\"\n  - 'svc'\n");
        write(
            &root.join("web/site/package.json"),
            r#"{ "scripts": { "dev": "vite --port 5321" } }"#,
        );
        write(
            &root.join("svc/package.json"),
            r#"{ "scripts": { "dev": "next dev -p 3321" } }"#,
        );

        let mut seen = HashSet::new();
        let servers = detect_workspace_servers(&root, "pnpm", &mut seen);
        assert_eq!(servers.len(), 2, "{:?}", servers);

        let _ = std::fs::remove_dir_all(&root);
    }
}
