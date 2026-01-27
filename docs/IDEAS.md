# Voice Mirror - Future Ideas

Ideas and features for future development.

---

## Voice Cloning via Conversation

**Status:** ✅ Implemented
**Priority:** High (differentiating feature)
**Dependencies:** Qwen3-TTS adapter (implemented), MCP tool (implemented)

### The Vision

User says: *"Hey Claude, I want you to sound like Morgan Freeman"*

Claude autonomously:
1. Searches the web for a clean audio sample
2. Downloads and processes it (ffmpeg: trim to 3s, normalize)
3. Transcribes the sample using Parakeet STT
4. Calls `clone_voice` MCP tool
5. Qwen3-TTS creates voice clone prompt
6. Claude responds in the cloned voice: *"Alright, how does this sound?"*

All in one conversational turn. No menus, no file uploads, no restart.

### Implementation (Completed)

**MCP Tools** (`mcp-server/index.js`):
- `clone_voice` - Clone a voice from URL or local file
- `clear_voice_clone` - Return to preset speaker voice
- `list_voice_clones` - List saved voice clones

**Audio Processing Pipeline**:
- Download audio via `yt-dlp` (YouTube, SoundCloud) or `curl` (direct URLs)
- Convert to WAV 16kHz mono via `ffmpeg`
- Trim to 5 seconds with silence removal and normalization
- Auto-transcribe using STT adapter (Parakeet/Whisper)
- Call `tts.set_voice_clone()` on Qwen adapter

**Voice Persistence**:
- Saved to `~/.config/voice-mirror-electron/data/voices/`
- Metadata stored as `{voice_name}.json`
- Processed audio stored as `{voice_name}_processed.wav`

**Settings UI**:
- TTS Engine selector (Kokoro / Qwen3-TTS)
- Model size selector for Qwen (0.6B / 1.7B)
- Voice selector updates based on engine

### Use Cases

| Request | Action |
|---------|--------|
| "Sound like David Attenborough" | Web search → clone |
| "Use my voice" | Record 3s via PTT → clone |
| "Clone this file" | Local path → clone |
| "Go back to normal" | `clear_voice_clone()` |

### Technical Notes

**Storage Requirements:**
- 0.6B model: ~1.5GB per variant (Base + CustomVoice = ~3GB total)
- 1.7B model: ~3.5GB per variant (Base + CustomVoice = ~7GB total)
- Voice cloning downloads BOTH Base (for cloning) and CustomVoice (for presets)
- Models cached in HuggingFace cache: `~/.cache/huggingface/`

**VRAM Requirements:**
- 0.6B: ~2GB VRAM
- 1.7B: ~4GB VRAM
- CPU fallback available but significantly slower

**Quality Notes:**
- Voice clone prompt is cached for efficiency
- Clone quality depends on sample clarity
- Works best with clear speech, minimal background noise
- 3-5 seconds of audio is optimal for cloning

---

## Dynamic Emotion/Style Control

**Status:** Concept
**Dependencies:** Qwen3-TTS `instruct` parameter

Claude could analyze response sentiment and add emotion instructions:

```python
# In speak(), analyze text and add instruction
if "excited" in response_analysis:
    instruct = "speak excitedly"
elif "sad" in response_analysis:
    instruct = "speak softly and sympathetically"
```

Or user-driven: *"Say that sarcastically"*

---

## Per-Context Voice Profiles

**Status:** Concept

Different voices for different contexts:
- Work mode: Professional voice
- Gaming: Energetic voice
- Night mode: Soft/whisper voice
- Custom persona: Cloned voice

Could tie into Electron's settings or be voice-commanded.

---

## Multi-Language Support

**Status:** Concept
**Dependencies:** Qwen3-TTS (supports 10 languages)

Qwen3-TTS supports: Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian.

Could auto-detect language from user speech and respond in same language.

---

## Voice Recording for Clone

**Status:** Concept

Add UI button or voice command to record user's own voice:
- "Clone my voice" → starts 3-second recording
- PTT-style: hold button, speak sample
- Auto-transcribe and setup clone

---

*Last updated: January 2026*
