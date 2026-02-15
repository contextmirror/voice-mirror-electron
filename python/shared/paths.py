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


def safe_path(path, allowed_base) -> str:
    """Resolve *path* and verify it is within *allowed_base*.

    Both arguments are resolved with ``os.path.realpath`` so symlinks
    and ``..`` components are collapsed before the check.

    Returns the resolved path string on success, raises ``ValueError``
    if the path escapes the allowed base directory.
    """
    resolved = os.path.realpath(str(path))
    base = os.path.realpath(str(allowed_base))
    # Allow the base itself or anything under base + separator
    if resolved == base or resolved.startswith(base + os.sep):
        return resolved
    raise ValueError(f"Path {path} is outside allowed directory {allowed_base}")
