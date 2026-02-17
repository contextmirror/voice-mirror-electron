//! Energy-based voice activity detection (fallback).
//!
//! Uses mean absolute amplitude as a simple energy metric.
//! Used when the neural Silero VAD model is not available.

/// Compute the energy level of an audio chunk.
///
/// Returns the mean absolute value of the samples — a simple proxy for
/// signal energy that works well enough for speech/silence discrimination.
pub fn detect(chunk: &[f32]) -> f32 {
    if chunk.is_empty() {
        return 0.0;
    }
    let sum: f32 = chunk.iter().map(|s| s.abs()).sum();
    sum / chunk.len() as f32
}
