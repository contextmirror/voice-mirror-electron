//! Clipboard-based text injection for dictation mode.
//!
//! Flow: save clipboard -> set text to clipboard -> simulate Ctrl+V
//! (Cmd+V on macOS) -> restore clipboard.

use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use tracing::{info, warn};

/// Inject text into the currently focused application by:
/// 1. Saving the current clipboard contents
/// 2. Setting the clipboard to the new text
/// 3. Simulating a paste keystroke (Ctrl+V / Cmd+V)
/// 4. Restoring the original clipboard contents
pub fn inject_text(text: &str) -> anyhow::Result<()> {
    if text.is_empty() {
        return Ok(());
    }

    info!(text_len = text.len(), "Injecting text via clipboard");

    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("Failed to open clipboard: {}", e))?;

    // Save current clipboard contents
    let previous = clipboard.get_text().ok();

    // Set new text to clipboard
    clipboard
        .set_text(text)
        .map_err(|e| anyhow::anyhow!("Failed to set clipboard text: {}", e))?;

    // Small delay for clipboard to settle
    thread::sleep(Duration::from_millis(50));

    // Simulate paste keystroke
    simulate_paste()?;

    // Small delay before restoring clipboard
    thread::sleep(Duration::from_millis(100));

    // Restore previous clipboard contents
    if let Some(prev) = previous {
        if let Err(e) = clipboard.set_text(prev) {
            warn!("Failed to restore clipboard: {}", e);
        }
    }

    Ok(())
}

/// Simulate a paste keystroke (Ctrl+V on Windows/Linux, Cmd+V on macOS).
fn simulate_paste() -> anyhow::Result<()> {
    use rdev::{simulate, EventType, Key};

    let delay = Duration::from_millis(20);

    // Press modifier
    let modifier = if cfg!(target_os = "macos") {
        Key::MetaLeft
    } else {
        Key::ControlLeft
    };

    simulate(&EventType::KeyPress(modifier))
        .map_err(|e| anyhow::anyhow!("Failed to simulate modifier press: {:?}", e))?;
    thread::sleep(delay);

    simulate(&EventType::KeyPress(Key::KeyV))
        .map_err(|e| anyhow::anyhow!("Failed to simulate V press: {:?}", e))?;
    thread::sleep(delay);

    simulate(&EventType::KeyRelease(Key::KeyV))
        .map_err(|e| anyhow::anyhow!("Failed to simulate V release: {:?}", e))?;
    thread::sleep(delay);

    simulate(&EventType::KeyRelease(modifier))
        .map_err(|e| anyhow::anyhow!("Failed to simulate modifier release: {:?}", e))?;

    Ok(())
}
