"""Text-to-Speech using Kokoro TTS."""

import asyncio
import re
import subprocess
from pathlib import Path
from typing import Callable, Optional


class TTSManager:
    """Manages text-to-speech using Kokoro TTS."""

    def __init__(self, voice: str = "af_bella"):
        """
        Initialize TTS manager.

        Args:
            voice: Voice ID for Kokoro (default "af_bella")
        """
        self.voice = voice
        self.model = None
        self._is_speaking = False
        self._soundfile = None  # Import lazily

    def load(self) -> bool:
        """
        Load the Kokoro TTS model.

        Returns:
            True if model loaded successfully
        """
        try:
            from kokoro_onnx import Kokoro
            import soundfile as sf
            self._soundfile = sf

            print(f"Loading Kokoro TTS model...")
            print("  (First run downloads model, please wait...)")
            self.model = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
            print(f"✅ Kokoro TTS loaded (voice: {self.voice})")
            return True
        except ImportError:
            print("❌ Kokoro TTS not available - install with: pip install kokoro-onnx")
            self.model = None
            return False
        except Exception as e:
            print(f"⚠️ Failed to load Kokoro TTS: {e}")
            self.model = None
            return False

    def strip_markdown(self, text: str) -> str:
        """
        Strip markdown syntax that sounds bad when spoken aloud.

        Args:
            text: Text potentially containing markdown

        Returns:
            Cleaned text suitable for TTS
        """
        # Remove headers (## Header -> Header)
        text = re.sub(r'#{1,6}\s*', '', text)
        # Remove bold (**text** -> text)
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
        # Remove italic (*text* -> text)
        text = re.sub(r'\*([^*]+)\*', r'\1', text)
        # Remove bullet points at line start
        text = re.sub(r'^[-*]\s+', '', text, flags=re.MULTILINE)
        # Remove numbered lists (1. item -> item)
        text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
        # Remove code blocks
        text = re.sub(r'```[^`]*```', '', text, flags=re.DOTALL)
        # Remove inline code (`code` -> code)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        # Remove horizontal rules
        text = re.sub(r'^---+$', '', text, flags=re.MULTILINE)
        # Clean up extra whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    async def speak(
        self,
        text: str,
        on_start: Optional[Callable[[], None]] = None,
        on_end: Optional[Callable[[], None]] = None
    ):
        """
        Convert text to speech and play it.

        Args:
            text: Text to speak
            on_start: Callback when speech starts (for pausing listeners)
            on_end: Callback when speech ends (for resuming listeners)
        """
        # Strip markdown before speaking
        text = self.strip_markdown(text)
        print(f"🔊 Speaking: {text[:50]}...")

        # Mark as speaking
        self._is_speaking = True

        # Notify start
        if on_start:
            on_start()

        try:
            if self.model is None:
                print("❌ Kokoro TTS not available")
                return

            if self._soundfile is None:
                import soundfile as sf
                self._soundfile = sf

            # Run Kokoro in thread pool to not block async loop
            loop = asyncio.get_event_loop()
            audio_data, sample_rate = await loop.run_in_executor(
                None,
                lambda: self.model.create(text, voice=self.voice)
            )

            # Save to temp file
            audio_file = Path("/tmp/voice_mirror_tts.wav")
            self._soundfile.write(str(audio_file), audio_data, sample_rate)

            # Play using ffplay
            subprocess.run(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(audio_file)],
                timeout=60
            )
        except Exception as e:
            print(f"❌ Kokoro TTS error: {e}")
        finally:
            self._is_speaking = False
            # Small delay to let audio system settle
            await asyncio.sleep(0.3)
            # Notify end
            if on_end:
                on_end()

    @property
    def is_speaking(self) -> bool:
        """Check if currently speaking."""
        return self._is_speaking

    @property
    def is_loaded(self) -> bool:
        """Check if the TTS model is loaded."""
        return self.model is not None
