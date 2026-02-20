//! Text injection via clipboard + simulated Ctrl+V paste.
//!
//! Used by the dictation feature to inject transcribed text into
//! whatever application/field is currently focused.

use tracing::{info, warn};

#[cfg(target_os = "windows")]
#[allow(clippy::upper_case_acronyms)] // Win32 FFI names match the Windows API
mod platform {
    use std::mem;
    use std::thread;
    use std::time::Duration;

    // Win32 SendInput types — must match the real Windows struct layout.
    // The union must include MOUSEINPUT (the largest member) so that
    // sizeof(INPUT) == 40 on 64-bit, which is what SendInput expects
    // for its cbSize parameter.

    #[repr(C)]
    struct INPUT {
        type_: u32,
        union: INPUT_UNION,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    union INPUT_UNION {
        mi: MOUSEINPUT,
        ki: KEYBDINPUT,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct MOUSEINPUT {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KEYBDINPUT {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const VK_CONTROL: u16 = 0x11;
    const VK_V: u16 = 0x56;

    extern "system" {
        fn SendInput(c_inputs: u32, p_inputs: *const INPUT, cb_size: i32) -> u32;
    }

    fn make_key(vk: u16, up: bool) -> INPUT {
        INPUT {
            type_: INPUT_KEYBOARD,
            union: INPUT_UNION {
                ki: KEYBDINPUT {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        }
    }

    /// Simulate Ctrl+V keystroke via SendInput.
    pub fn simulate_paste() {
        let inputs = [
            make_key(VK_CONTROL, false),
            make_key(VK_V, false),
            make_key(VK_V, true),
            make_key(VK_CONTROL, true),
        ];

        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                mem::size_of::<INPUT>() as i32,
            )
        };

        tracing::debug!(
            sent,
            expected = inputs.len(),
            cb_size = mem::size_of::<INPUT>(),
            "SendInput Ctrl+V"
        );

        // Brief delay to let the target app process the paste
        thread::sleep(Duration::from_millis(80));
    }
}

/// Inject text into the currently focused field via clipboard + Ctrl+V.
///
/// Runs on a blocking thread to avoid blocking the tokio runtime.
/// Adds a small initial delay to let any UI focus changes settle.
pub async fn inject_text(text: &str) -> Result<(), String> {
    let text = text.to_string();

    tokio::task::spawn_blocking(move || inject_text_sync(&text))
        .await
        .map_err(|e| format!("Inject task panicked: {}", e))?
}

fn inject_text_sync(text: &str) -> Result<(), String> {
    use arboard::Clipboard;

    info!(len = text.len(), "Injecting text via clipboard paste");

    // Small delay to let focus settle after voice recording stops
    std::thread::sleep(std::time::Duration::from_millis(50));

    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;

    // Save current clipboard text (best-effort)
    let previous = clipboard.get_text().ok();

    // Set our text
    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to set clipboard text: {}", e))?;

    // Small delay to ensure clipboard is ready
    std::thread::sleep(std::time::Duration::from_millis(30));

    // Simulate Ctrl+V
    #[cfg(target_os = "windows")]
    platform::simulate_paste();

    #[cfg(not(target_os = "windows"))]
    {
        warn!("Text injection is only supported on Windows");
        return Err("Text injection is only supported on Windows".into());
    }

    // Restore previous clipboard (delayed to ensure paste completes)
    if let Some(prev) = previous {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if let Err(e) = clipboard.set_text(&prev) {
            warn!("Failed to restore clipboard: {}", e);
        }
    }

    Ok(())
}
