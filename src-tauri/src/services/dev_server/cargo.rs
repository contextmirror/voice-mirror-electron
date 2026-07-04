//! Native Rust (Cargo) desktop-app detection.
//!
//! A Cargo project (egui/eframe, iced, native winit apps…) has NO web dev
//! server, no `package.json`, no CDP — it's a native window run via `cargo run`.
//! To make "any app" include these, detect a Cargo project's runnable binaries
//! (`cargo metadata`), auto-pick the most app-like one, and expose the rest as
//! switchable run targets. The launcher runs the chosen `cargo run …` command;
//! the preview mirrors the resulting OS window (found via the launch's process
//! tree) and drives it via UI Automation. `port` is 0 and `native` is true.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

use super::{DetectedDevServer, RunTarget};

/// Detect a native Cargo app. Returns `None` when there's no `Cargo.toml`, when
/// `cargo metadata` fails, or when the project exposes no runnable binary.
pub(super) fn detect_cargo_app(root: &Path) -> Option<DetectedDevServer> {
    if !root.join("Cargo.toml").exists() {
        return None;
    }

    let bins = list_workspace_bins(root)?;
    if bins.is_empty() {
        return None;
    }

    // Auto-pick the most "app-like" binary; the rest become switchable targets.
    let chosen = pick_default_bin(&bins);
    let run_targets: Vec<RunTarget> = bins
        .iter()
        .map(|(pkg, bin)| RunTarget {
            label: bin.clone(),
            command: run_command(pkg, bin),
        })
        .collect();

    Some(DetectedDevServer {
        framework: "Rust (Cargo)".to_string(),
        port: 0, // native app — no dev server / port
        url: String::new(),
        start_command: run_command(&chosen.0, &chosen.1),
        source: format!("Cargo.toml → cargo run -p {}", chosen.0),
        running: false,
        native: true,
        run_targets,
        ..Default::default()
    })
}

/// `cargo run` command for a (package, bin). When the bin name equals the
/// package name (the common case, incl. egui_demo_app) `-p <pkg>` suffices;
/// otherwise disambiguate with `--bin`.
fn run_command(pkg: &str, bin: &str) -> String {
    if pkg == bin {
        format!("cargo run -p {}", pkg)
    } else {
        format!("cargo run -p {} --bin {}", pkg, bin)
    }
}

/// All `(package_name, bin_name)` runnable binaries in the workspace, via
/// `cargo metadata` (the authoritative source — handles virtual workspaces,
/// members, and `[[bin]]` targets that file-scanning would miss).
fn list_workspace_bins(root: &Path) -> Option<Vec<(String, String)>> {
    let mut cmd = Command::new("cargo");
    cmd.arg("metadata")
        .arg("--no-deps")
        .arg("--format-version")
        .arg("1")
        .current_dir(root);
    crate::util::hidden(&mut cmd);

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let meta: Value = serde_json::from_slice(&output.stdout).ok()?;

    let mut bins: Vec<(String, String)> = Vec::new();
    for pkg in meta.get("packages")?.as_array()? {
        let pkg_name = pkg.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(targets) = pkg.get("targets").and_then(|v| v.as_array()) {
            for t in targets {
                let is_bin = t
                    .get("kind")
                    .and_then(|k| k.as_array())
                    .map(|k| k.iter().any(|x| x.as_str() == Some("bin")))
                    .unwrap_or(false);
                if is_bin {
                    if let Some(bin_name) = t.get("name").and_then(|v| v.as_str()) {
                        bins.push((pkg_name.to_string(), bin_name.to_string()));
                    }
                }
            }
        }
    }
    Some(bins)
}

/// Auto-pick the most app-like binary: prefer a name signalling a GUI app
/// (demo/app/gui/desktop/main), else a sole bin, else the first. The picker
/// lets the user override, so this only needs to be a good default.
fn pick_default_bin(bins: &[(String, String)]) -> (String, String) {
    const HINTS: [&str; 6] = ["demo", "app", "gui", "desktop", "main", "example"];
    // Rank by how strongly the bin name signals "the app".
    let score = |bin: &str| -> i32 {
        let b = bin.to_ascii_lowercase();
        let mut s = 0;
        for (i, h) in HINTS.iter().enumerate() {
            if b.contains(h) {
                // Earlier hints (demo/app) weigh more than later (example).
                s += (HINTS.len() - i) as i32;
            }
        }
        // A bin that is JUST a hint word ("app") beats one that merely contains it.
        if HINTS.contains(&b.as_str()) {
            s += 2;
        }
        s
    };
    bins.iter()
        .max_by_key(|(_, bin)| score(bin))
        .cloned()
        .unwrap_or_else(|| bins[0].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_app_like_bin() {
        let bins = vec![
            ("xtask".to_string(), "xtask".to_string()),
            ("hello_world".to_string(), "hello_world".to_string()),
            ("egui_demo_app".to_string(), "egui_demo_app".to_string()),
            ("confirm_exit".to_string(), "confirm_exit".to_string()),
        ];
        let (pkg, bin) = pick_default_bin(&bins);
        assert_eq!(pkg, "egui_demo_app");
        assert_eq!(bin, "egui_demo_app");
    }

    #[test]
    fn run_command_uses_p_when_names_match_else_bin() {
        assert_eq!(run_command("egui_demo_app", "egui_demo_app"), "cargo run -p egui_demo_app");
        assert_eq!(run_command("mycrate", "tool"), "cargo run -p mycrate --bin tool");
    }

    #[test]
    fn sole_bin_is_picked() {
        let bins = vec![("solo".to_string(), "solo".to_string())];
        assert_eq!(pick_default_bin(&bins), ("solo".to_string(), "solo".to_string()));
    }
}
