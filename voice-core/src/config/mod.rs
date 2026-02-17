//! Configuration reading and data directory paths.

pub mod paths;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::warn;

use paths::get_data_dir;

/// Top-level voice_config.json shape (written by Electron settings panel).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    #[serde(default)]
    pub user_name: Option<String>,
    #[serde(default)]
    pub activation_mode: Option<String>,
    #[serde(default)]
    pub ptt_key: Option<String>,
    #[serde(default)]
    pub voice: Option<VoiceAdapterConfig>,
}

/// Nested voice adapter settings inside voice_config.json.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAdapterConfig {
    #[serde(default)]
    pub tts_adapter: Option<String>,
    #[serde(default)]
    pub tts_voice: Option<String>,
    #[serde(default)]
    pub tts_model_size: Option<String>,
    #[serde(default)]
    pub tts_volume: Option<f64>,
    #[serde(default)]
    pub tts_api_key: Option<String>,
    #[serde(default)]
    pub tts_endpoint: Option<String>,
    #[serde(default)]
    pub tts_model_path: Option<String>,
    #[serde(default)]
    pub stt_adapter: Option<String>,
    #[serde(default)]
    pub stt_api_key: Option<String>,
    #[serde(default)]
    pub stt_endpoint: Option<String>,
    #[serde(default)]
    pub stt_model_name: Option<String>,
}

/// voice_settings.json shape (snake_case, read by the voice agent).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VoiceSettings {
    #[serde(default)]
    pub tts_adapter: Option<String>,
    #[serde(default)]
    pub tts_voice: Option<String>,
    #[serde(default)]
    pub tts_model_size: Option<String>,
    #[serde(default)]
    pub tts_volume: Option<f64>,
    #[serde(default)]
    pub tts_api_key: Option<String>,
    #[serde(default)]
    pub tts_endpoint: Option<String>,
    #[serde(default)]
    pub tts_model_path: Option<String>,
    #[serde(default)]
    pub stt_adapter: Option<String>,
    #[serde(default)]
    pub stt_api_key: Option<String>,
    #[serde(default)]
    pub stt_endpoint: Option<String>,
    #[serde(default)]
    pub stt_model_name: Option<String>,
}

/// Read voice_config.json from the data directory.
pub fn read_voice_config() -> VoiceConfig {
    let path = get_config_path();
    read_json_file(&path).unwrap_or_default()
}

/// Read voice_settings.json from the data directory.
pub fn read_voice_settings() -> VoiceSettings {
    let path = get_voice_settings_path();
    read_json_file(&path).unwrap_or_default()
}

/// Path to voice_config.json.
pub fn get_config_path() -> PathBuf {
    get_data_dir().join("voice_config.json")
}

/// Path to voice_settings.json.
pub fn get_voice_settings_path() -> PathBuf {
    get_data_dir().join("voice_settings.json")
}

/// Generic helper: read a JSON file and deserialize it.
fn read_json_file<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(val) => Some(val),
            Err(e) => {
                warn!("Failed to parse {}: {}", path.display(), e);
                None
            }
        },
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to read {}: {}", path.display(), e);
            }
            None
        }
    }
}
