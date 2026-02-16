"""Cross-platform text injection via clipboard + simulated paste."""

import ctypes
import platform
import subprocess
import sys
import time


def inject_text(text: str) -> bool:
    """Write text to clipboard and simulate Ctrl/Cmd+V paste.

    Returns True on success, False on failure or empty text.
    """
    if not text or not text.strip():
        return False

    system = platform.system()

    try:
        _write_clipboard(text, system)
        time.sleep(0.05)  # 50ms for clipboard to settle
        _simulate_paste(system)
        return True
    except Exception as e:
        print(f"Text injection failed: {e}")
        return False


def _write_clipboard_win32(text: str):
    """Write text to clipboard using Win32 ctypes (avoids spawning PowerShell)."""
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    encoded = text.encode("utf-16-le")
    # Allocate global memory: encoded bytes + 2 null bytes for UTF-16 terminator
    buf_size = len(encoded) + 2
    h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, buf_size)
    if not h_mem:
        raise RuntimeError("GlobalAlloc failed")

    try:
        ptr = kernel32.GlobalLock(h_mem)
        if not ptr:
            raise RuntimeError("GlobalLock failed")
        ctypes.memmove(ptr, encoded, len(encoded))
        # Write null terminator
        ctypes.memset(ptr + len(encoded), 0, 2)
        kernel32.GlobalUnlock(h_mem)

        if not user32.OpenClipboard(0):
            raise RuntimeError("OpenClipboard failed")
        try:
            user32.EmptyClipboard()
            if not user32.SetClipboardData(CF_UNICODETEXT, h_mem):
                raise RuntimeError("SetClipboardData failed")
            h_mem = None  # Clipboard owns the memory now
        finally:
            user32.CloseClipboard()
    finally:
        if h_mem:
            kernel32.GlobalFree(h_mem)


def _write_clipboard(text: str, system: str):
    """Write text to the system clipboard."""
    if system == "Windows":
        try:
            _write_clipboard_win32(text)
        except Exception:
            # Fall back to PowerShell if ctypes fails
            p = subprocess.Popen(
                ["powershell", "-NoProfile", "-Command", "$input | Set-Clipboard"],
                stdin=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            p.communicate(input=text.encode("utf-8"))
    elif system == "Darwin":
        p = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        p.communicate(input=text.encode("utf-8"))
    else:
        # Linux: prefer wl-copy (Wayland), fall back to xclip (X11)
        import shutil

        if shutil.which("wl-copy"):
            p = subprocess.Popen(["wl-copy"], stdin=subprocess.PIPE)
            p.communicate(input=text.encode("utf-8"))
        elif shutil.which("xclip"):
            p = subprocess.Popen(
                ["xclip", "-selection", "clipboard"],
                stdin=subprocess.PIPE,
            )
            p.communicate(input=text.encode("utf-8"))
        else:
            raise RuntimeError("No clipboard utility found (need wl-copy or xclip)")


def _simulate_paste(system: str):
    """Simulate Ctrl+V (or Cmd+V on macOS) using pynput."""
    from pynput.keyboard import Controller, Key

    kb = Controller()

    if system == "Darwin":
        with kb.pressed(Key.cmd):
            kb.tap("v")
    else:
        with kb.pressed(Key.ctrl):
            kb.tap("v")
