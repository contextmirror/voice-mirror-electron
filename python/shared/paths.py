"""Cross-platform path helpers for Voice Mirror Python backend."""

import os
import platform
from pathlib import Path


def get_config_base() -> Path:
    """Get the platform-appropriate base config directory."""
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(base)
    elif system == "Darwin":
        return Path.home() / "Library" / "Application Support"
    else:
        return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))


def get_data_dir() -> Path:
    """Get the Voice Mirror data directory (cross-platform)."""
    return get_config_base() / "voice-mirror-electron" / "data"
