//! App-launch plumbing for the sandbox preview.
//!
//! Two jobs:
//!
//! 1. **Launch acknowledgements** — `sandbox_start` (MCP, backend) hands the
//!    actual launch to the frontend's devServerManager via a Tauri event. That
//!    hop used to be fire-and-forget: if the Lens workspace wasn't mounted or
//!    the start silently no-oped, the tool still reported "launching". Now every
//!    `sandbox-start-request` carries a `launchId`; the frontend MUST answer via
//!    the `sandbox_start_ack` command, and the backend awaits the matching
//!    receiver here. No ACK ⇒ the tool reports the drop honestly.
//!
//! 2. **CDP port allocation** — the debug port for a launched dev app used to be
//!    a formula (`9223 + dev_port % 1000`) duplicated in JS and Rust, which
//!    collided for dev ports 1000 apart (3000/4000) and drifted silently. The
//!    frontend now asks `find_free_cdp_port` for a genuinely free port and
//!    reports the chosen port back through the ACK.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::oneshot;

// ---------------------------------------------------------------------------
// Launch acknowledgements
// ---------------------------------------------------------------------------

/// What the frontend actually did with a `sandbox-start-request`.
///
/// `status` is one of:
/// - `"spawned"` — a PTY was spawned and the start command sent
/// - `"already-running"` — a tracked server exists AND its port was re-verified listening
/// - `"already-starting"` — a launch is already in flight; this request was coalesced
/// - `"refused"` — nothing was launched; `reason` says why (crash loop, no dev
///   server detected, spawn failure, no project path, …)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAck {
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub dev_port: Option<u16>,
    #[serde(default)]
    pub cdp_port: Option<u16>,
    #[serde(default)]
    pub framework: Option<String>,
}

static NEXT_LAUNCH_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: OnceLock<Mutex<HashMap<u64, oneshot::Sender<LaunchAck>>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<u64, oneshot::Sender<LaunchAck>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a new launch and get `(launch_id, receiver)`. The receiver resolves
/// when the frontend calls `sandbox_start_ack` with the same id.
pub fn register() -> (u64, oneshot::Receiver<LaunchAck>) {
    let id = NEXT_LAUNCH_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, tx);
    (id, rx)
}

/// Deliver the frontend's acknowledgement. Returns `false` when nothing was
/// waiting (unknown/expired id, or a duplicate ACK).
pub fn ack(id: u64, ack: LaunchAck) -> bool {
    let tx = pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    match tx {
        Some(tx) => tx.send(ack).is_ok(),
        None => false,
    }
}

/// Drop a pending launch registration (the waiter timed out).
pub fn cancel(id: u64) {
    pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
}

// ---------------------------------------------------------------------------
// CDP port allocation
// ---------------------------------------------------------------------------

/// Scan range for dev-app CDP debug ports. Starts ABOVE the host's own CDP port
/// (9222, `HOST_CDP_PORT` in lib.rs) so a launched app can never shadow Voice
/// Mirror itself, and ends below the MJPEG stream pool (9876+).
const CDP_PORT_RANGE: std::ops::Range<u16> = 9223..9500;

/// How long an allocated port is reserved before it can be handed out again.
/// Covers the window between allocation and the launched app actually binding
/// it (a cold `tauri dev` build can take minutes).
const RECENT_ALLOCATION_TTL: Duration = Duration::from_secs(300);

static RECENTLY_ALLOCATED: OnceLock<Mutex<HashMap<u16, Instant>>> = OnceLock::new();

fn recently_allocated() -> &'static Mutex<HashMap<u16, Instant>> {
    RECENTLY_ALLOCATED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Find a genuinely free port for `--remote-debugging-port`.
///
/// Free = we can bind it right now AND it wasn't handed out to another launch
/// in the last few minutes (the app may not have bound it yet mid-build).
pub fn find_free_cdp_port() -> Option<u16> {
    let mut recent = recently_allocated()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    recent.retain(|_, t| now.duration_since(*t) < RECENT_ALLOCATION_TTL);

    for port in CDP_PORT_RANGE {
        if recent.contains_key(&port) {
            continue;
        }
        // A successful bind proves nothing holds it; the listener drops here.
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            recent.insert(port, now);
            return Some(port);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ack_resolves_registered_launch() {
        let (id, rx) = register();
        assert!(ack(
            id,
            LaunchAck {
                status: "spawned".into(),
                reason: None,
                dev_port: Some(1420),
                cdp_port: Some(9231),
                framework: Some("Tauri".into()),
            }
        ));
        let got = rx.await.expect("ack delivered");
        assert_eq!(got.status, "spawned");
        assert_eq!(got.cdp_port, Some(9231));
    }

    #[test]
    fn ack_unknown_id_returns_false() {
        assert!(!ack(
            u64::MAX,
            LaunchAck {
                status: "spawned".into(),
                reason: None,
                dev_port: None,
                cdp_port: None,
                framework: None,
            }
        ));
    }

    #[tokio::test]
    async fn cancel_drops_pending_sender() {
        let (id, rx) = register();
        cancel(id);
        // Sender dropped ⇒ receiver errors; a late ACK finds nothing.
        assert!(rx.await.is_err());
    }

    #[test]
    fn free_port_is_bindable_and_not_repeated() {
        let a = find_free_cdp_port().expect("a free port in range");
        let b = find_free_cdp_port().expect("a second free port");
        assert_ne!(a, b, "recent allocations must not be re-issued");
        assert!(CDP_PORT_RANGE.contains(&a));
        assert!(CDP_PORT_RANGE.contains(&b));
    }
}
