//! IPC bridge: stdin reader and stdout event emitter.
//!
//! Pattern borrowed from wayland-orb/src/ipc.rs — a blocking stdin reader
//! thread that sends deserialized commands through an mpsc channel, plus a
//! helper to emit JSON-line events to stdout.

use std::io::{self, BufRead, Write};

use tokio::sync::mpsc;
use tracing::{debug, error};

use super::{VoiceCommand, VoiceEvent};

/// Emit a `VoiceEvent` as a JSON line on stdout and flush.
pub fn emit_event(event: &VoiceEvent) {
    let json = match serde_json::to_string(event) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("Failed to serialize event: {}", e);
            return;
        }
    };
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    // Ignore write/flush errors — pipe may be closed.
    let _ = writeln!(handle, "{}", json);
    let _ = handle.flush();
}

/// Convenience helper for emitting error events.
pub fn emit_error(message: &str) {
    emit_event(&VoiceEvent::Error {
        message: message.to_string(),
    });
}

/// Spawn a blocking thread that reads JSON lines from stdin, deserializes
/// them into `VoiceCommand`, and forwards them through the returned channel.
///
/// The thread exits when stdin is closed (parent process gone) or on
/// unrecoverable read error.
pub fn spawn_stdin_reader() -> mpsc::UnboundedReceiver<VoiceCommand> {
    let (tx, rx) = mpsc::unbounded_channel();

    std::thread::spawn(move || {
        let stdin = io::stdin();
        let reader = stdin.lock();
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<VoiceCommand>(&trimmed) {
                        Ok(cmd) => {
                            debug!(?cmd, "Received command from Electron");
                            if tx.send(cmd).is_err() {
                                break; // Receiver dropped — main task is gone.
                            }
                        }
                        Err(e) => {
                            error!("Invalid JSON command: {} — input: {}", e, trimmed);
                            emit_error(&format!("Invalid JSON command: {}", e));
                        }
                    }
                }
                Err(e) => {
                    error!("stdin read error: {}", e);
                    break; // stdin closed
                }
            }
        }
        debug!("stdin reader thread exiting");
    });

    rx
}
