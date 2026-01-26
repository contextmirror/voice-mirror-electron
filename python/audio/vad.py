"""Voice Activity Detection (VAD) - pure functions for audio energy analysis."""

import numpy as np


def detect_speech_energy(audio: np.ndarray, threshold: float = 0.01) -> bool:
    """
    Check if audio contains speech based on energy threshold.

    Args:
        audio: Audio samples as numpy array
        threshold: Energy threshold for speech detection (default 0.01)

    Returns:
        True if audio energy exceeds threshold
    """
    return np.abs(audio).mean() > threshold


def get_audio_level(audio: np.ndarray) -> tuple[float, float]:
    """
    Get max level and mean energy from audio chunk.

    Args:
        audio: Audio samples as numpy array

    Returns:
        Tuple of (max_level, mean_energy)
    """
    level = np.abs(audio).max()
    energy = np.abs(audio).mean()
    return level, energy
