# docs/

Project documentation for Voice Mirror.

> **Voice Mirror** is a voice-native IDE built on **Tauri 2** (Rust backend, Svelte 5 frontend). You build apps and websites by voice, watch them render live in an in-app App Preview, and the in-app AI can see and drive the running app. The **Lens workspace** combines a CodeMirror editor with LSP, a file tree, a live browser/app preview, an integrated terminal, and dev-server management. The launch is **Windows-first** — the live App Preview, native-app driving, and push-to-talk are Windows-only for v1. The `src-tauri/` directory holds the Rust backend; `src/` the Svelte frontend.

## Folder Structure

```
docs/
├── source-of-truth/   Living decision-making docs (architecture, audits, gap analyses)
├── guides/            User- and contributor-facing setup and feature docs
├── internal/          Internal roadmaps and launch tracking (gitignored — local only)
├── archive/           Historical designs, audits, and completed-plan specs
├── ROADMAP.md         High-level project roadmap
├── CODE-AUDIT.md      Codebase audit notes
└── README.md          This file
```

## Source of Truth

Living documents that track the current state of the project and drive decisions.

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](source-of-truth/ARCHITECTURE.md) | System overview, component diagram, data flow |
| [BROWSER-CONTROL.md](source-of-truth/BROWSER-CONTROL.md) | Browser/app control via the native WebView2 bridge |
| [IDE-GAPS.md](source-of-truth/IDE-GAPS.md) | IDE feature gap analysis vs VS Code / Zed |
| [LSP.md](source-of-truth/LSP.md) | LSP architecture, 37/37 feature matrix, and wiring pointers |
| [AUDIT-TRACKER.md](source-of-truth/AUDIT-TRACKER.md) | Cross-audit tracker / status roll-up |

## Guides

How-to docs for getting started and using features.

| File | Description |
|------|-------------|
| [GETTING-STARTED.md](guides/GETTING-STARTED.md) | Dev setup, project structure, commands, testing |
| [CONFIGURATION.md](guides/CONFIGURATION.md) | Config file locations, settings reference, environment variables |
| [VOICE-PIPELINE.md](guides/VOICE-PIPELINE.md) | Voice pipeline: STT (Whisper), TTS (Kokoro / Edge), VAD |
| [THEME-SYSTEM.md](guides/THEME-SYSTEM.md) | Theme presets, color derivation, custom themes |

## Internal

`docs/internal/` holds roadmaps and launch tracking maintained by the core team (launch-readiness checklist, App Preview lifecycle roadmap). It is **gitignored** — the files exist only in local working copies, not in the public repo.

## Archive

Historical design specs kept for their non-obvious rationale (WGC/D3D11 window capture, the MCP handshake, WebView2 download/inspector gotchas, Python dev-server/venv detection, async-command performance, workspace-state persistence) plus older scoping notes and superseded audits — including the LSP docs consolidated into `source-of-truth/LSP.md` (gap analysis, wiring audit, original design) and the 2026-03-04 UX audit snapshot. Completed step-by-step implementation plans were removed once shipped; the surviving specs hold knowledge worth keeping. Browse the directory for the full set.

## Also See

- [../README.md](../README.md) — project landing page and quick start
- [../CLAUDE.md](../CLAUDE.md) — project context for AI assistants
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contributor onboarding guide
- [ROADMAP.md](ROADMAP.md) — high-level roadmap

## Suggested Reading Order

1. **guides/GETTING-STARTED.md** — get a dev environment running
2. **source-of-truth/ARCHITECTURE.md** — system overview: Rust backend, Svelte 5 frontend, Lens workspace
3. **guides/CONFIGURATION.md** — settings, AI providers, voice engine
4. **guides/VOICE-PIPELINE.md** — the Rust-native STT/TTS/VAD pipeline
5. **source-of-truth/BROWSER-CONTROL.md** — native WebView2 browser/app integration
6. the internal App Preview lifecycle notes (`docs/internal/`, local only) — how the live App Preview tracks and drives the running app
7. **source-of-truth/LSP.md** — if working on the Lens editor
8. **source-of-truth/IDE-GAPS.md** — feature and UX gap tracking
