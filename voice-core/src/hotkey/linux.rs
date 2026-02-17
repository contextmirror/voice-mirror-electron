//! Linux-specific hotkey extensions.
//!
//! On Wayland, rdev may not work for global key capture because Wayland
//! doesn't allow applications to intercept input. The `evdev` crate can
//! read /dev/input directly (requires user to be in the `input` group).

// TODO: Implement evdev-based hotkey listener for Wayland.
// 1. Enumerate /dev/input devices via evdev::enumerate()
// 2. Filter to devices that have the target key/button capabilities
// 3. Use a selector (epoll) to multiplex reads from multiple devices
// 4. EV_KEY events: value=1 (press), value=0 (release), value=2 (repeat)
// 5. Mouse buttons: BTN_MIDDLE=0x112, BTN_SIDE=0x113, BTN_EXTRA=0x114
//
// The evdev crate is already in Cargo.toml as a Linux-only dependency.
