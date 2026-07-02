# Voice Mirror -- Development Guide

Voice Mirror uses **Tauri 2** with a Svelte 5 frontend and Rust backend. This guide covers everything you need for local development.

## Quick Start

```bash
# Install frontend dependencies
npm install

# Run in development mode (rebuilds MCP binary + Vite HMR + Rust auto-rebuild)
npm run dev

# Run JS tests (6700+ tests)
npm test

# Run Rust tests
npm run test:rust

# Run all tests (JS + Rust)
npm run test:all

# Svelte type checking
npm run check

# Verify Rust compiles (fast check, no codegen)
cd src-tauri && cargo check
```

**Important:** Always use `npm run dev` instead of `tauri dev` directly. The npm script first kills any stale `voice-mirror-mcp.exe` (the `predev` step) and then rebuilds the `voice-mirror-mcp` binary (`cargo build --manifest-path src-tauri/Cargo.toml --bin voice-mirror-mcp`), which `tauri dev` does not do. A stale MCP binary silently loses new features due to serde dropping unknown fields.

> Voice Mirror's own Vite dev server runs on **port 31420** (HMR on **31421**) -- deliberately moved off the default Tauri/Vite `1420` so apps you build and preview inside Voice Mirror (which default to `1420`) never collide with it. See `vite.config.js` and `tauri.conf.json` (`devUrl: http://localhost:31420`).

---

## Project Structure

```
voice-mirror/
├── src-tauri/                          # Rust backend
│   ├── src/
│   │   ├── main.rs                     # App entry, window creation
│   │   ├── lib.rs                      # Tauri setup + command registration, event forwarding loops
│   │   ├── commands/                   # Tauri command modules (~20 modules)
│   │   │   ├── config / window / voice / ai / chat / tools / shortcuts
│   │   │   ├── files/                  # File ops + git (submodule tree)
│   │   │   ├── lens/                   # WebView2 browser preview (submodule tree)
│   │   │   ├── lsp.rs                  # Language server protocol (45 commands)
│   │   │   ├── terminal.rs             # Shell PTY spawning
│   │   │   ├── sandbox.rs              # See-and-drive App Preview (CDP/UIA)
│   │   │   └── screenshot / dev_server / output / design / project / mcp / onboarding / workspace_state
│   │   ├── config/                     # Config schema + persistence (atomic writes) + crypto
│   │   ├── providers/                  # AI providers: cli/ (portable-pty), api.rs (HTTP), manager
│   │   ├── voice/                      # Rust-native pipeline: pipeline/, stt (whisper-rs), tts/ (Kokoro/Edge), vad
│   │   ├── terminal/                   # Shell PTY session management
│   │   ├── lsp/                        # LSP client, server lifecycle, requests (11 modules)
│   │   ├── mcp/                        # Native Rust MCP server: server, tools, pipe_router, handlers/
│   │   ├── ipc/                        # Named-pipe IPC (MCP binary <-> Tauri app)
│   │   ├── services/                   # browser_bridge, cdp, sandbox/uia, window_stream/follow,
│   │   │                               #   file/inbox watchers, input_hook, crash/hang handlers, logger, ...
│   │   └── bin/mcp.rs                  # voice-mirror-mcp binary entry point
│   ├── Cargo.toml                      # Rust dependencies
│   ├── rustfmt.toml                    # Rust formatting config
│   └── tauri.conf.json                 # Tauri window, bundle, plugin config
├── src/                                # Svelte 5 frontend
│   ├── App.svelte                      # Root component
│   ├── main.js                         # Entry point + browser-behavior suppression
│   ├── components/                     # ~105 components across 8 directories
│   │   ├── lens/                       # IDE workspace (48): LensWorkspace/LensToolbar/CommandPalette
│   │   │   ├── editor/                 #   CodeMirror editor, tabs, diff viewer, LSP UI
│   │   │   ├── tree/                   #   File tree + context menu
│   │   │   ├── browser/                #   Browser chrome: tab bar, find, history, downloads, device preview
│   │   │   ├── viewers/                #   PDF / Office / image / binary viewers
│   │   │   ├── panels/                 #   Output, Problems, References, Outline, Search
│   │   │   ├── status/                 #   Status bar dropdown, LSP/MCP/server tabs
│   │   │   ├── preview/                #   App Preview (see-and-drive) + Lens webview host
│   │   │   └── git/                    #   Changes + commit panels
│   │   ├── terminal/                   # xterm.js terminals (10): AI terminal, shells, tabs, splits
│   │   ├── chat/                       # Chat panel (9)
│   │   ├── settings/                   # Settings panels (17, incl. appearance/)
│   │   ├── shared/                     # Reusable primitives (16): Button, SplitPanel, ...
│   │   ├── sidebar/ overlay/ onboarding/
│   ├── lib/
│   │   ├── api.js                      # invoke() wrappers for the Tauri command surface
│   │   ├── editor/                     # CodeMirror/LSP modules: extensions, theme, git gutter,
│   │   │                               #   languages, editor-lsp, hover-markdown, lsp-severity
│   │   ├── terminal/                   # terminal-links, link overlay, scrollback search
│   │   ├── stores/                     # 32 reactive stores (Svelte 5 runes)
│   │   └── ...                         # utils, providers, file-icons, commands registry, etc.
│   ├── styles/                         # 11 CSS files (tokens, base, terminal, panel, ...)
│   └── assets/                         # Icons (file-type sprite, provider logos)
├── test/                               # ~6850 JS tests (node:test), tree mirrors src/
│   ├── components/                     # Source-inspection tests (subfolders match src/components/)
│   ├── lib/ stores/ api/ editor/       # Library / store / API-surface tests
│   ├── rust/                           # Source-inspection tests for src-tauri (commands/, lsp/)
│   └── integration/ diagnostics/ styles/
├── docs/                               # Documentation (guides/, source-of-truth/, archive/)
├── scripts/                            # Release staging (make-release, release-nightly) + CDP harness
├── .github/                            # CI, release, CodeQL, Scorecard, dependabot, templates
├── index.html                          # HTML entry point
├── vite.config.js                      # Vite + Svelte config
└── package.json                        # Frontend deps + npm scripts
```

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `predev` | `taskkill /F /IM voice-mirror-mcp.exe` | Kills any stale MCP process before `dev` (auto-run) |
| `dev` | Builds MCP binary + `tauri dev` | Development mode (Vite HMR on :31420 + Rust hot-reload) |
| `build` | Builds MCP binary (release) + `tauri build` | Production build |
| `preview` | `vite build` + `vite preview --port 31420` + `cargo run --features native-ml,cuda` | Run a production frontend against the native backend |
| `check` | `svelte-check` | Svelte type checking |
| `test` | `node --test "test/**/*.test.cjs" "test/**/*.test.mjs"` | Run all JS tests (6700+) |
| `test:rust` | `cd src-tauri && cargo test` | Run Rust tests |
| `test:all` | `npm test && npm run test:rust` | Run both JS and Rust tests |

Additional commands via Cargo:

| Command | Purpose |
|---------|---------|
| `cd src-tauri && cargo check` | Fast Rust compilation check |
| `cd src-tauri && cargo clippy` | Rust linting |
| `cd src-tauri && cargo test --bin voice-mirror-mcp` | MCP binary tests only |

---

## Dependencies

### Rust (Cargo.toml)

| Crate | Purpose |
|-------|---------|
| tauri (v2) | Desktop app framework |
| tauri-plugin-shell | Shell command execution |
| tauri-plugin-updater | Auto-update support |
| tauri-plugin-global-shortcut | Global keyboard shortcuts |
| tauri-plugin-single-instance | Single instance enforcement |
| tauri-plugin-autostart | Launch on system startup |
| tauri-plugin-dialog | Native file dialogs |
| serde / serde_json | Serialization |
| tokio | Async runtime |
| portable-pty | PTY spawning for CLI AI agents |
| reqwest | HTTP client for API providers |
| cpal / rodio | Audio capture and playback |
| whisper-rs (optional) | Speech-to-text (Whisper C++ FFI) |
| ort (optional) | ONNX Runtime for Kokoro TTS |
| tracing / tracing-subscriber | Structured logging |
| notify | File system watching |
| webview2-com / windows | WebView2 COM API (Windows, for browser bridge) |

### Frontend (package.json)

| Package | Purpose |
|---------|---------|
| svelte (v5) | UI framework with runes |
| @sveltejs/vite-plugin-svelte | Svelte Vite integration |
| vite | Build tool + dev server |
| @xterm/xterm + addons | Terminal emulator (WebGL) -- AI agent (Voice Agent) + user-shell terminals |
| codemirror + @codemirror/* | Code editor (Lens file editor) |
| highlight.js + marked-highlight | Syntax highlighting in chat markdown |
| marked | Markdown rendering |
| dompurify | HTML sanitization |
| fuzzysort | Fuzzy search (command palette) |
| @tauri-apps/api | Tauri frontend API |
| @tauri-apps/plugin-dialog | File dialog API |
| @tauri-apps/plugin-shell | Shell API |
| @tauri-apps/plugin-updater | Updater API |

### Build Features

The Rust backend has optional features controlled via `Cargo.toml` and `tauri.conf.json`:

| Feature | Crates | Purpose |
|---------|--------|---------|
| `whisper` | whisper-rs | Local STT via Whisper C++ (whisper.cpp GGML) |
| `cuda` | whisper-rs/cuda | GPU (CUDA) acceleration for Whisper STT |
| `onnx` | ort, zip, byteorder | Local TTS via Kokoro ONNX |
| `native-ml` | whisper + onnx | Both local ML features |

The default feature set is empty. Development and release builds enable `native-ml` **and** `cuda` (configured in `tauri.conf.json` under `build.features: ["native-ml", "cuda"]`). CUDA acceleration lets Whisper run large models (e.g. `large-v3`) in real time on an NVIDIA GPU; it falls back to CPU when no GPU is available.

---

## Testing

### Test Paths

| Path | Type | Pattern |
|------|------|---------|
| `test/unit/` | Pure JS unit tests | Direct import (.mjs) |
| `test/stores/` | Svelte store tests | Source inspection (.cjs) |
| `test/api/` | API wrapper tests | Source inspection (.cjs) |
| `test/components/` | Component tests | Source inspection (.cjs) |
| `test/lib/` | Library tests | Mixed |
| `src-tauri/src/**` | Rust tests | `#[cfg(test)]` inline |

### Running Tests

```bash
# All JS tests (6700+)
npm test

# Single JS test file
node --test test/unit/utils.test.mjs

# All Rust tests
npm run test:rust

# MCP binary tests only
cd src-tauri && cargo test --bin voice-mirror-mcp

# Both JS + Rust
npm run test:all
```

**Note:** `cargo test --lib` fails on Windows due to WebView2 DLL issues in the test harness. Use `cargo check --tests` for compilation verification and `cargo test --bin voice-mirror-mcp` for MCP binary tests.

### Test Patterns

**Direct import** -- for pure JS modules that don't use Svelte runes:
```js
// test/unit/utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge } from '../../src/lib/utils.js';

describe('deepMerge', () => {
    it('should merge nested objects', () => {
        const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } });
        assert.deepStrictEqual(result, { a: { b: 1, c: 2 } });
    });
});
```

**Source inspection** -- for Svelte stores (`.svelte.js`) and components (`.svelte`) that can't be imported in Node.js:
```js
// test/stores/theme.test.cjs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../src/lib/stores/theme.svelte.js'), 'utf-8'
);

describe('theme store', () => {
    it('should export PRESETS', () => {
        assert.ok(src.includes('export const PRESETS'));
    });

    it('should have all required color keys in colorblind preset', () => {
        for (const key of ['bg', 'bgElevated', 'text', 'textStrong', 'muted', 'accent', 'ok', 'warn', 'danger', 'orbCore']) {
            assert.ok(src.includes(key), `missing color key: ${key}`);
        }
    });
});
```

**Rust tests** -- inline in source modules:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = AppConfig::default();
        assert_eq!(config.appearance.theme, "colorblind");
    }
}
```

---

## Debugging & Logging

### Rust Logging

The backend uses `tracing` for structured logging:

```rust
tracing::info!("Provider started: {}", provider_name);
tracing::error!("Failed to load config: {}", err);
tracing::debug!(voice_state = ?state, "Voice pipeline update");
```

Log output goes to:
- **Console** (stderr) during development (`npm run dev`)
- **MCP binary** logs to stderr (stdout is reserved for JSON-RPC)

### Frontend Debugging

- Vite dev server runs on `http://localhost:31420` with HMR (websocket on `31421`)
- Open DevTools in the Tauri window (right-click > Inspect, or the Tauri dev menu)
- Svelte DevTools browser extension works with Tauri's WebView

### Common Debug Commands

```bash
# Watch Rust logs during development
npm run dev 2>&1 | grep -E "(INFO|ERROR|WARN)"

# Check Rust compilation without running
cd src-tauri && cargo check

# Run Rust linter
cd src-tauri && cargo clippy

# Verify frontend builds cleanly
npx vite build
```

---

## Architecture Notes

### Tauri Command Pattern

Frontend communicates with the Rust backend via `invoke()`:

```
Svelte Component
  → api.js (invoke wrapper)
    → Tauri IPC bridge
      → #[tauri::command] fn in Rust
        → returns Result<T, String> serialized as JSON
```

All `invoke()` calls are centralized in `src/lib/api.js`. Components never call `invoke()` directly.

Tauri automatically converts camelCase JavaScript argument names to snake_case Rust parameter names.

### Svelte Store Pattern

Reactive state uses Svelte 5 runes in `.svelte.js` files:

```js
// src/lib/stores/config.svelte.js
let config = $state(structuredClone(DEFAULT_CONFIG));

export function getConfig() { return config; }
export function setConfig(patch) {
    config = deepMerge(config, patch);
}
```

Stores are imported by components and api.js. The `.svelte.js` extension is required because Svelte 5 runes (`$state`, `$derived`, `$effect`) are only processed by the Svelte compiler in `.svelte` and `.svelte.js`/`.svelte.ts` files.

### Provider System

Two categories of AI providers:

**CLI Agent Providers** (PTY-based via `portable-pty`):
- Claude Code (`claude`), OpenCode (`opencode`)
- Full terminal access with streaming output, MCP tool groups
- Managed in `src-tauri/src/providers/cli/`

**HTTP API Providers** (streaming via `reqwest`):
- Ollama, LM Studio, Jan (auto-detected local LLM servers)
- OpenAI-compatible `/v1/chat/completions` endpoint
- Managed in `src-tauri/src/providers/api.rs`

There is also a **Dictation Only** provider (`src-tauri/src/providers/dictation.rs`) -- speech-to-text with no AI, injecting transcribed text into the focused window.

The active provider is chosen by **right-clicking the "Voice Agent" tab** (or in Settings > AI Provider). Provider metadata lives in `src/lib/providers.js`; lifecycle (start/stop/switch) is managed by `src-tauri/src/providers/manager.rs`.

### Voice Pipeline

The voice pipeline is fully Rust-native (no separate child process):

| Component | Implementation | Location |
|-----------|---------------|----------|
| Audio capture | cpal | `voice/pipeline.rs` |
| Audio playback | rodio | `voice/tts.rs` |
| STT | whisper-rs (whisper.cpp GGML, optional CUDA) | `voice/stt.rs` |
| TTS | Kokoro ONNX / Edge TTS | `voice/tts/mod.rs` |
| VAD | Energy-based detection | `voice/vad.rs` |

### MCP Server

The MCP server is a native Rust binary (`voice-mirror-mcp`) that communicates via stdio JSON-RPC:

- Entry point: `src-tauri/src/bin/mcp.rs`
- Tool registry: `src-tauri/src/mcp/tools.rs` (5 groups: core, memory, browser, capture, n8n; dynamic load/unload)
- Handlers: `src-tauri/src/mcp/handlers/` (6 handler modules)
- Pipe router: `src-tauri/src/mcp/pipe_router.rs` (concurrent oneshot/mpsc routing)
- Named pipe IPC connects the MCP binary to the running Tauri app for real-time communication

### Config System

Configuration flows through two layers:

1. **Frontend** (`config.svelte.js`): `DEFAULT_CONFIG` provides defaults, `deepMerge(DEFAULT_CONFIG, saved)` fills missing fields
2. **Backend** (`config/`): `schema.rs` defines the Rust struct (`AppConfig` + sub-configs), `persistence.rs` handles file I/O (atomic writes), `crypto.rs` encrypts API keys (AES-256-GCM), `migration.rs` handles Electron config migration

Config is stored at:
- Windows: `%APPDATA%/voice-mirror/config.json`
- Linux/macOS: `~/.config/voice-mirror/config.json`

### Theme System

8 built-in theme presets defined in `src/lib/stores/theme.svelte.js`:
- Each preset has 10 required color keys + font definitions
- `deriveTheme()` generates 30+ CSS custom properties from the base colors
- Default theme is `colorblind`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Gemini API key |
| `GROQ_API_KEY` | Groq API key |
| `TAURI_DEV_HOST` | Custom dev server host (for remote development) |

---

## Troubleshooting

### `npm run dev` fails

- Ensure Tauri CLI is installed: `cargo install tauri-cli`
- Ensure frontend deps are installed: `npm install`
- On Linux, install WebKit and GTK dev headers
- Try `cd src-tauri && cargo check` to isolate Rust vs frontend issues

### Voice pipeline not working

- Ensure the `native-ml` feature is enabled (default in `tauri.conf.json`)
- Check that the Whisper GGML model is downloaded (auto-downloads from HuggingFace on first use)
- Check audio device permissions on your OS

### No audio output

- Verify audio output device is available (`rodio` uses the system default)
- Check Rust console logs for TTS errors

### AI provider not connecting

- For CLI providers: verify the CLI tool is installed and on PATH (e.g., `claude --version`)
- For API providers: verify the server is running (e.g., `ollama list`)
- Check the Tauri console output for error messages

### Tests failing

- JS tests: ensure you're running from the repo root (`npm test`)
- Rust tests: `cargo test --lib` fails on Windows (WebView2 DLL issue) -- use `cargo test --bin voice-mirror-mcp`
- Some tests may require the `native-ml` feature: `cargo test --features native-ml`

### MCP binary stale

- If MCP tools aren't working after code changes, the binary may be stale
- `tauri dev` does NOT rebuild the MCP binary -- always use `npm run dev`
- Serde silently drops unknown fields, so stale binaries lose features without errors
