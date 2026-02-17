//! Voice Mirror — Rust voice processing core.
//!
//! Communicates with Electron via JSON-line IPC on stdin/stdout.
//! This is the entry point that initializes all subsystems and runs the
//! main event loop.

mod audio;
mod config;
mod hotkey;
mod inbox;
mod ipc;
mod stt;
mod text_injector;
mod tts;
mod vad;
mod wake_word;

use tracing::info;
use tracing_subscriber::EnvFilter;

use config::{read_voice_config, read_voice_settings};
use ipc::bridge::{emit_event, spawn_stdin_reader};
use ipc::{AudioDeviceInfo, VoiceCommand, VoiceEvent};

#[tokio::main]
async fn main() {
    // Initialize tracing (respects RUST_LOG env, defaults to info)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    // Emit starting event immediately so Electron knows we're alive.
    emit_event(&VoiceEvent::Starting {});

    // Read config
    emit_event(&VoiceEvent::Loading {
        step: "Reading configuration...".to_string(),
    });
    let voice_config = read_voice_config();
    let voice_settings = read_voice_settings();
    info!(?voice_config, ?voice_settings, "Configuration loaded");

    // Spawn stdin reader (blocking thread -> async channel)
    emit_event(&VoiceEvent::Loading {
        step: "Starting IPC bridge...".to_string(),
    });
    let mut cmd_rx = spawn_stdin_reader();

    // TODO: Initialize audio subsystem
    emit_event(&VoiceEvent::Loading {
        step: "Initializing audio...".to_string(),
    });

    // TODO: Initialize VAD
    emit_event(&VoiceEvent::Loading {
        step: "Loading VAD model...".to_string(),
    });

    // TODO: Initialize wake word
    emit_event(&VoiceEvent::Loading {
        step: "Loading wake word model...".to_string(),
    });

    // TODO: Initialize STT
    emit_event(&VoiceEvent::Loading {
        step: "Loading STT model...".to_string(),
    });

    // TODO: Initialize TTS
    emit_event(&VoiceEvent::Loading {
        step: "Loading TTS engine...".to_string(),
    });

    // All subsystems ready
    emit_event(&VoiceEvent::Ready {});
    info!("Voice core ready");

    // Main loop: process commands from Electron
    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(command) => {
                        if !handle_command(command).await {
                            break; // Stop command received
                        }
                    }
                    None => {
                        // stdin closed — parent process gone
                        info!("stdin closed, shutting down");
                        break;
                    }
                }
            }
            // TODO: select on audio events, VAD events, wake word detections, etc.
        }
    }

    info!("Voice core shutting down");
}

/// Handle a single command from Electron.
/// Returns `false` if the main loop should exit.
async fn handle_command(cmd: VoiceCommand) -> bool {
    match cmd {
        VoiceCommand::Ping {} => {
            emit_event(&VoiceEvent::Pong {});
        }

        VoiceCommand::Stop {} => {
            emit_event(&VoiceEvent::Stopping {});
            return false;
        }

        VoiceCommand::ListAudioDevices {} => {
            // TODO: enumerate real devices via cpal
            let input = Vec::<AudioDeviceInfo>::new();
            let output = Vec::<AudioDeviceInfo>::new();
            emit_event(&VoiceEvent::AudioDevices { input, output });
        }

        VoiceCommand::ConfigUpdate { config } => {
            info!("Config update received");
            // TODO: apply config changes (write to disk, reload adapters)
            emit_event(&VoiceEvent::ConfigUpdated { config });
        }

        VoiceCommand::SetMode { mode } => {
            info!(mode = %mode, "Mode change requested");
            // TODO: apply mode change
            emit_event(&VoiceEvent::ModeChange { mode });
        }

        VoiceCommand::Query { text, image } => {
            info!(text = ?text, has_image = image.is_some(), "Query received");
            // TODO: route to inbox / conversation pipeline
        }

        VoiceCommand::StartRecording {} => {
            info!("Start recording requested");
            // TODO: trigger PTT recording
        }

        VoiceCommand::StopRecording {} => {
            info!("Stop recording requested");
            // TODO: stop PTT recording
        }

        VoiceCommand::SystemSpeak { text } => {
            info!(text = %text, "System speak requested");
            // TODO: speak via TTS without entering conversation mode
        }

        VoiceCommand::ListAdapters {} => {
            // TODO: enumerate real adapters
            emit_event(&VoiceEvent::AdapterList {
                tts: vec![],
                stt: vec![],
            });
        }
    }

    true
}
