//! MP3 to f32 PCM decoding via Symphonia.

use super::TtsError;

/// Decode MP3 bytes to mono f32 PCM samples using Symphonia.
pub(crate) fn decode_mp3_to_f32(mp3_bytes: &[u8]) -> Result<Vec<f32>, TtsError> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    // .to_vec() is required: MediaSourceStream::new takes Box<dyn MediaSource> which
    // implies 'static, so Cursor<&[u8]> (borrowed) cannot be used here.
    let cursor = std::io::Cursor::new(mp3_bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp3");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| TtsError::SynthesisError(format!("MP3 probe failed: {}", e)))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| TtsError::SynthesisError("No audio track in MP3".into()))?;
    let track_id = track.id;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| TtsError::SynthesisError(format!("MP3 decoder init failed: {}", e)))?;

    let mut all_samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => {
                return Err(TtsError::SynthesisError(format!("MP3 decode error: {}", e)));
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("MP3 packet decode error (skipping): {}", e);
                continue;
            }
        };
        let spec = *decoded.spec();
        let duration = decoded.capacity();
        let mut sample_buf = SampleBuffer::<f32>::new(duration as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        if channels == 1 {
            all_samples.extend_from_slice(samples);
        } else {
            // Downmix to mono by averaging channels
            for chunk in samples.chunks(channels) {
                let sum: f32 = chunk.iter().sum();
                all_samples.push(sum / channels as f32);
            }
        }
    }

    Ok(all_samples)
}
