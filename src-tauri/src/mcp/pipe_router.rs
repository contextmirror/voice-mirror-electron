//! Pipe message router for the MCP binary.
//!
//! Routes incoming `AppToMcp` messages from the pipe to the appropriate handler:
//! - `BrowserResponse` -> oneshot channel matched by request_id
//! - `UserMessage` -> mpsc channel consumed by voice_listen
//! - `Shutdown` -> mpsc channel consumed by voice_listen
//!
//! This solves the concurrency issue where both `voice_listen` and
//! `pipe_browser_request` need to receive from the same pipe connection.
//!
//! When the pipe drops (the Tauri app restarted), the dispatch task:
//! 1. Drops the user-message sender so a blocked `voice_listen` sees the
//!    channel close and falls back to inbox.json polling immediately.
//! 2. Fails all in-flight request waiters (dropping the oneshot senders)
//!    instead of leaking them until their timeouts.
//! 3. Reconnects with capped backoff (1s -> 30s, indefinitely) — the app side
//!    re-listens after a disconnect (`run_pipe_server_loop`) — then swaps in
//!    the new connection and a fresh user-message channel.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::{info, warn};

use crate::ipc::pipe_client::{self, PipeClient};
use crate::ipc::protocol::{AppToMcp, McpToApp};

/// Routes pipe messages to the appropriate handler.
pub struct PipeRouter {
    /// Current pipe connection. Swapped by the dispatch task on reconnect.
    pipe: RwLock<Arc<PipeClient>>,
    /// Pending browser requests waiting for responses, keyed by request_id.
    browser_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<AppToMcp>>>>,
    /// Channel for UserMessage/Shutdown delivery (voice_listen consumes from
    /// the paired receiver). Taken (dropped) on pipe disconnect so the
    /// receiver sees `None`; a fresh sender is installed on reconnect.
    user_messages_tx: std::sync::Mutex<Option<mpsc::UnboundedSender<AppToMcp>>>,
    /// Receiver for user messages. Protected by mutex for single-consumer use.
    /// Replaced together with the sender on reconnect.
    pub user_messages_rx: Mutex<mpsc::UnboundedReceiver<AppToMcp>>,
}

impl PipeRouter {
    pub fn new(pipe: Arc<PipeClient>) -> Arc<Self> {
        let (tx, rx) = mpsc::unbounded_channel();
        Arc::new(Self {
            pipe: RwLock::new(pipe),
            browser_waiters: Arc::new(Mutex::new(HashMap::new())),
            user_messages_tx: std::sync::Mutex::new(Some(tx)),
            user_messages_rx: Mutex::new(rx),
        })
    }

    /// Start the background message dispatch loop.
    ///
    /// Spawns a tokio task that reads from the pipe and routes each message
    /// to the appropriate channel. On pipe close/error it fails pending
    /// waiters, closes the user-message channel (so voice_listen falls back
    /// to file polling), and reconnects with capped backoff — indefinitely.
    pub fn start_dispatch(self: &Arc<Self>) {
        let router = Arc::clone(self);
        tokio::spawn(async move {
            info!("[PipeRouter] Starting dispatch loop");
            loop {
                // Hold the current connection for this generation only.
                let client = router.pipe.read().await.clone();
                loop {
                    match client.recv().await {
                        Ok(Some(msg)) => router.dispatch(msg).await,
                        Ok(None) => {
                            info!("[PipeRouter] Pipe closed (EOF)");
                            break;
                        }
                        Err(e) => {
                            warn!("[PipeRouter] Pipe recv error: {}", e);
                            break;
                        }
                    }
                }

                router.handle_disconnect().await;

                let new_client = reconnect_with_backoff().await;
                router.install_connection(new_client).await;
            }
        });
    }

    /// Disconnect cleanup: unblock voice_listen and fail in-flight waiters.
    async fn handle_disconnect(&self) {
        // Drop the user-message sender: voice_listen's `rx.recv()` then
        // returns `None` and it falls back to inbox.json polling instead of
        // blocking its full timeout on a dead pipe.
        if let Ok(mut guard) = self.user_messages_tx.lock() {
            guard.take();
        }
        // Fail in-flight request waiters instead of leaking them: dropping
        // the oneshot senders errors the receivers immediately.
        let mut waiters = self.browser_waiters.lock().await;
        if !waiters.is_empty() {
            warn!(
                "[PipeRouter] Failing {} in-flight request(s) due to pipe disconnect",
                waiters.len()
            );
        }
        waiters.clear();
    }

    /// Install a fresh connection + user-message channel after a reconnect.
    async fn install_connection(&self, client: Arc<PipeClient>) {
        *self.pipe.write().await = client;

        // Fresh user-message channel (the old one was closed on disconnect).
        // A voice_listen that held the receiver saw `None` and released the
        // lock, so this swap can't block for long.
        let (tx, rx) = mpsc::unbounded_channel();
        if let Ok(mut guard) = self.user_messages_tx.lock() {
            *guard = Some(tx);
        }
        *self.user_messages_rx.lock().await = rx;

        info!("[PipeRouter] Reconnected — pipe connection restored");
    }

    /// Route a single message to the appropriate handler.
    async fn dispatch(&self, msg: AppToMcp) {
        match &msg {
            AppToMcp::BrowserResponse { request_id, .. }
            | AppToMcp::CaptureResponse { request_id, .. }
            | AppToMcp::LogEntries { request_id, .. } => {
                let mut waiters = self.browser_waiters.lock().await;
                if let Some(tx) = waiters.remove(request_id) {
                    let _ = tx.send(msg);
                } else {
                    warn!(
                        "[PipeRouter] No waiter for response: {}",
                        request_id
                    );
                }
            }
            AppToMcp::UserMessage { .. } | AppToMcp::Shutdown => {
                let tx = match self.user_messages_tx.lock() {
                    Ok(guard) => guard.clone(),
                    Err(_) => None,
                };
                match tx {
                    Some(tx) => {
                        if tx.send(msg).is_err() {
                            warn!("[PipeRouter] User message channel closed");
                        }
                    }
                    None => {
                        warn!("[PipeRouter] No user-message sender installed, dropping message");
                    }
                }
            }
        }
    }

    /// Register a waiter for a browser response and return the receiver.
    pub async fn wait_for_browser_response(
        &self,
        request_id: &str,
    ) -> oneshot::Receiver<AppToMcp> {
        let (tx, rx) = oneshot::channel();
        self.browser_waiters
            .lock()
            .await
            .insert(request_id.to_string(), tx);
        rx
    }

    /// Remove a waiter that is no longer needed (e.g. after timeout).
    ///
    /// Prevents stale entries from leaking memory in the waiters map when
    /// the response never arrives.
    pub async fn remove_waiter(&self, request_id: &str) {
        self.browser_waiters.lock().await.remove(request_id);
    }

    /// Send a message through the pipe to the Tauri app.
    pub async fn send(&self, msg: &McpToApp) -> Result<(), std::io::Error> {
        let client = self.pipe.read().await.clone();
        client.send(msg).await
    }
}

/// Reconnect to the app's pipe with capped backoff (1s -> 30s), retrying
/// indefinitely. Re-reads `VOICE_MIRROR_PIPE` on every attempt so a changed
/// pipe name is picked up. Returns the connected client (which has already
/// sent the `Ready` handshake).
async fn reconnect_with_backoff() -> Arc<PipeClient> {
    let mut backoff = Duration::from_secs(1);
    loop {
        match std::env::var("VOICE_MIRROR_PIPE") {
            Ok(name) if !name.is_empty() => {
                match pipe_client::connect_to_pipe(&name, 1).await {
                    Ok(client) => {
                        info!("[PipeRouter] Reconnected to pipe: {}", name);
                        return client;
                    }
                    Err(e) => {
                        warn!(
                            "[PipeRouter] Reconnect failed: {} — retrying in {}s",
                            e,
                            backoff.as_secs()
                        );
                    }
                }
            }
            _ => {
                warn!(
                    "[PipeRouter] VOICE_MIRROR_PIPE not set — retrying in {}s",
                    backoff.as_secs()
                );
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}
