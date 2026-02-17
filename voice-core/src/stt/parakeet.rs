//! Deprecated: Parakeet STT has been replaced by whisper-local.
//!
//! This stub exists for backward compatibility — the `SttAdapter` enum no
//! longer includes a Parakeet variant. The `create_stt_engine()` factory
//! redirects "parakeet" adapter requests to whisper-local automatically.
//!
//! This module is intentionally kept empty to avoid compile errors from
//! `pub mod parakeet;` in mod.rs.
