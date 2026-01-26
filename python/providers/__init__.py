"""AI provider configuration and inbox communication."""

from .config import (
    ActivationMode,
    PROVIDER_DISPLAY_NAMES,
    ELECTRON_CONFIG_PATH,
    get_ai_provider,
    get_activation_mode,
    strip_provider_prefix,
)
from .inbox import InboxManager, cleanup_inbox

__all__ = [
    "ActivationMode",
    "PROVIDER_DISPLAY_NAMES",
    "ELECTRON_CONFIG_PATH",
    "get_ai_provider",
    "get_activation_mode",
    "strip_provider_prefix",
    "InboxManager",
    "cleanup_inbox",
]
