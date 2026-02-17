//! Windows-specific hotkey extensions.
//!
//! Placeholder for Win32 low-level hooks that can suppress mouse button
//! events (prevent browser-back on Mouse4, system beep on bound keys).
//! The main rdev-based listener in mod.rs works on Windows, but for
//! event suppression we may need raw Win32 hooks via the `windows` crate.

// TODO: Implement Win32 low-level keyboard/mouse hooks for event suppression.
// Use SetWindowsHookExW with WH_KEYBOARD_LL and WH_MOUSE_LL.
// The `windows` crate features already include Win32_UI_Input_KeyboardAndMouse.
//
// Key considerations:
// - Hook callback must return quickly (Windows unhooks after ~300ms timeout)
// - Must pump messages (GetMessage/PeekMessage loop) on the hook thread
// - Suppression: return non-zero from hook proc to swallow the event
// - XButton1/XButton2: check MSLLHOOKSTRUCT.mouseData >> 16 for button ID
