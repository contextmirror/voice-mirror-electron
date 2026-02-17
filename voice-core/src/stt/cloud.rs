//! Cloud-based STT adapters (OpenAI Whisper API, custom endpoint).

use reqwest::multipart;
use tracing::debug;

use super::SttEngine;

/// Encode f32 audio samples as 16-bit PCM WAV bytes.
///
/// Assumes 16 kHz mono input.
fn encode_wav(audio: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_samples = audio.len() as u32;
    let bytes_per_sample: u16 = 2; // 16-bit
    let num_channels: u16 = 1;
    let data_size = num_samples * bytes_per_sample as u32;
    let file_size = 36 + data_size; // RIFF header is 44 bytes total, minus 8 for RIFF+size

    let mut buf = Vec::with_capacity(44 + data_size as usize);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt sub-chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // sub-chunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * num_channels as u32 * bytes_per_sample as u32;
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = num_channels * bytes_per_sample;
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&(bytes_per_sample * 8).to_le_bytes()); // bits per sample

    // data sub-chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());
    for &sample in audio {
        let clamped = sample.clamp(-1.0, 1.0);
        let pcm = (clamped * 32767.0) as i16;
        buf.extend_from_slice(&pcm.to_le_bytes());
    }

    buf
}

// ---------------------------------------------------------------------------
// OpenAI Whisper API
// ---------------------------------------------------------------------------

/// OpenAI Whisper API STT adapter.
pub struct OpenAiStt {
    api_key: String,
    client: reqwest::Client,
}

impl OpenAiStt {
    pub fn new(api_key: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            client: reqwest::Client::new(),
        }
    }
}

impl SttEngine for OpenAiStt {
    async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
        let wav = encode_wav(audio, 16_000);
        debug!(bytes = wav.len(), "Sending audio to OpenAI Whisper API");

        let file_part = multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")?;

        let form = multipart::Form::new()
            .text("model", "whisper-1")
            .part("file", file_part);

        let resp = self
            .client
            .post("https://api.openai.com/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OpenAI STT API error {}: {}", status, body);
        }

        let json: serde_json::Value = resp.json().await?;
        let text = json["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(text)
    }
}

// ---------------------------------------------------------------------------
// Custom API endpoint
// ---------------------------------------------------------------------------

/// User-configured custom STT endpoint.
pub struct CustomApiStt {
    endpoint: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl CustomApiStt {
    pub fn new(endpoint: &str, api_key: Option<String>) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            api_key,
            client: reqwest::Client::new(),
        }
    }
}

impl SttEngine for CustomApiStt {
    async fn transcribe(&self, audio: &[f32]) -> anyhow::Result<String> {
        let wav = encode_wav(audio, 16_000);
        debug!(
            bytes = wav.len(),
            endpoint = %self.endpoint,
            "Sending audio to custom STT endpoint"
        );

        let file_part = multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")?;

        let form = multipart::Form::new()
            .text("model", "whisper-1")
            .part("file", file_part);

        let mut req = self.client.post(&self.endpoint).multipart(form);

        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Custom STT API error {}: {}", status, body);
        }

        let json: serde_json::Value = resp.json().await?;
        let text = json["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(text)
    }
}
