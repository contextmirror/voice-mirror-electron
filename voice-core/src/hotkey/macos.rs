//! macOS-specific hotkey extensions.
//!
//! rdev works on macOS via Quartz Event Taps, which requires the
//! Accessibility permission in System Preferences. The main rdev-based
//! listener in mod.rs should work on macOS without additional code.

// TODO: If rdev's macOS support proves insufficient, implement
// CGEvent tap via core-graphics crate for lower-level access.
// This would allow event suppression on macOS as well.
