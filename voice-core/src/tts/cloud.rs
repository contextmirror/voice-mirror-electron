//! Cloud TTS adapters: Edge TTS, OpenAI TTS, ElevenLabs TTS.
//!
//! Each adapter sends text to a cloud API and returns f32 PCM audio samples.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};

use tracing::info;

use super::TtsEngine;

// ---------------------------------------------------------------------------
// Edge TTS (free Microsoft voices)
// ---------------------------------------------------------------------------

/// Microsoft Edge TTS — free cloud synthesis via WebSocket.
///
/// Uses the same endpoint as the Edge browser's "Read Aloud" feature:
/// `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
pub struct EdgeTts {
    voice: String,
    interrupted: AtomicBool,
}

impl EdgeTts {
    pub fn new(voice: &str) -> Self {
        Self {
            voice: voice.to_string(),
            interrupted: AtomicBool::new(false),
        }
    }

    /// Available Edge TTS voices.
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &[
            "en-US-AriaNeural",
            "en-US-GuyNeural",
            "en-US-JennyNeural",
            "en-GB-SoniaNeural",
            "en-GB-RyanNeural",
            "en-AU-NatashaNeural",
        ]
    }
}

impl TtsEngine for EdgeTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            // TODO: Implement WebSocket protocol for Edge TTS:
            // 1. Connect to wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
            //    with query params: TrustedClientToken=<token>&ConnectionId=<uuid>
            // 2. Send SSML configuration message:
            //    Content-Type:application/ssml+xml
            //    Path:ssml
            //    X-RequestId:<uuid>
            //    <speak version='1.0' xml:lang='en-US'>
            //      <voice name='{voice}'>{text}</voice>
            //    </speak>
            // 3. Receive binary audio frames (mp3 with header prefix "Path:audio\r\n")
            // 4. Decode mp3 to f32 PCM samples
            //
            // Dependencies needed: tokio-tungstenite for WebSocket, symphonia or minimp3 for decode

            anyhow::bail!(
                "Edge TTS WebSocket protocol not yet implemented (voice={})",
                self.voice
            )
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("Edge TTS ({})", self.voice)
    }
}

// ---------------------------------------------------------------------------
// OpenAI TTS
// ---------------------------------------------------------------------------

/// OpenAI TTS — paid cloud synthesis via REST API.
///
/// POST `https://api.openai.com/v1/audio/speech`
/// Body: `{"model": "tts-1", "input": "text", "voice": "alloy"}`
/// Returns audio bytes (mp3/opus).
pub struct OpenAiTts {
    api_key: String,
    voice: String,
    model: String,
    interrupted: AtomicBool,
    client: reqwest::Client,
}

impl OpenAiTts {
    pub fn new(api_key: &str, voice: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            voice: voice.to_string(),
            model: "tts-1".to_string(),
            interrupted: AtomicBool::new(false),
            client: reqwest::Client::new(),
        }
    }

    /// Available OpenAI TTS voices.
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    }
}

impl TtsEngine for OpenAiTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            info!(voice = %self.voice, text_len = text.len(), "OpenAI TTS request");

            let body = serde_json::json!({
                "model": self.model,
                "input": text,
                "voice": self.voice,
                "response_format": "pcm",
            });

            let resp = self
                .client
                .post("https://api.openai.com/v1/audio/speech")
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("OpenAI TTS request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!("OpenAI TTS API error {}: {}", status, body);
            }

            // PCM format returns raw 24kHz 16-bit mono PCM
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to read OpenAI TTS response: {}", e))?;

            // Convert i16 PCM to f32 samples
            let samples: Vec<f32> = bytes
                .chunks_exact(2)
                .map(|chunk| {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    sample as f32 / 32768.0
                })
                .collect();

            info!(samples = samples.len(), "OpenAI TTS synthesis complete");
            Ok(samples)
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("OpenAI TTS ({})", self.voice)
    }
}

// ---------------------------------------------------------------------------
// ElevenLabs TTS
// ---------------------------------------------------------------------------

/// ElevenLabs TTS — paid cloud synthesis via REST API.
///
/// POST `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
/// Returns audio bytes (mp3).
pub struct ElevenLabsTts {
    api_key: String,
    voice_id: String,
    interrupted: AtomicBool,
    client: reqwest::Client,
}

impl ElevenLabsTts {
    pub fn new(api_key: &str, voice_id: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            voice_id: voice_id.to_string(),
            interrupted: AtomicBool::new(false),
            client: reqwest::Client::new(),
        }
    }

    /// Available ElevenLabs voice names (defaults).
    #[allow(dead_code)]
    pub fn available_voices() -> &'static [&'static str] {
        &[
            "Rachel", "Domi", "Bella", "Antoni", "Elli", "Josh", "Arnold", "Adam", "Sam",
        ]
    }
}

impl TtsEngine for ElevenLabsTts {
    fn speak(&self, text: &str) -> Pin<Box<dyn Future<Output = anyhow::Result<Vec<f32>>> + Send + '_>> {
        let text = text.to_string();
        Box::pin(async move {
            self.interrupted.store(false, Ordering::SeqCst);

            if text.trim().is_empty() {
                return Ok(Vec::new());
            }

            info!(voice = %self.voice_id, text_len = text.len(), "ElevenLabs TTS request");

            let url = format!(
                "https://api.elevenlabs.io/v1/text-to-speech/{}",
                self.voice_id
            );

            let body = serde_json::json!({
                "text": text,
                "model_id": "eleven_monolingual_v1",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.5,
                }
            });

            let resp = self
                .client
                .post(&url)
                .header("xi-api-key", &self.api_key)
                .header("Accept", "audio/mpeg")
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("ElevenLabs TTS request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!("ElevenLabs TTS API error {}: {}", status, body);
            }

            let bytes = resp
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to read ElevenLabs response: {}", e))?;

            // TODO: Decode mp3 bytes to f32 PCM samples.
            // Need symphonia, minimp3, or similar crate for mp3 decoding.
            // For now, return an error indicating the decoding step is needed.
            anyhow::bail!(
                "ElevenLabs TTS received {} bytes of mp3 audio but mp3 decoding not yet implemented",
                bytes.len()
            )
        })
    }

    fn stop(&self) {
        self.interrupted.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> String {
        format!("ElevenLabs ({})", self.voice_id)
    }
}
