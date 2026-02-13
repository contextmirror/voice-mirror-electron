# Future Improvements (Out of Scope)

Items identified during the code quality audit that are deferred for future work.

---

## Renderer Component Framework
- The renderer (electron/js/) uses vanilla JS with direct DOM manipulation
- A lightweight framework (Vue, Svelte, or Lit) would improve maintainability
- **Why deferred**: App works well, rewrite risk is high, no immediate benefit
- **Trigger**: When adding significant new UI features

## Python Backend Refactoring
- Python backend (python/) handles STT, TTS, VAD, wake word, hotkeys
- Could benefit from async architecture review and better module separation
- **Why deferred**: Separate codebase, separate effort, currently stable
- **Trigger**: When adding new audio features or Python performance issues

## MCP Server Architecture
- MCP server (mcp-server/) is already well-structured after v0.8.1 cleanup
- Memory system could benefit from query optimization
- **Why deferred**: Already clean, no pressing issues
- **Trigger**: Memory performance or feature expansion

## Secure Credential Storage
- API keys currently stored as plaintext in config.json
- Should use OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux)
- **Why deferred**: Nice-to-have, config.json is user-local, not a blocking issue
- **Trigger**: If distributing to non-technical users or security audit

## Settings UI Decomposition
- settings.js is 1,956 lines — largest file in the codebase
- Could be split into: providers.js, themes.js, keybindings.js, voice.js
- **Why deferred**: High-risk UI refactor, tightly coupled to DOM, works fine
- **Trigger**: When next significant settings feature is added

## Service Registry / DI Container
- Services are initialized manually in main.js with explicit wiring
- A service registry would decouple initialization from main.js
- **Why deferred**: Current explicit wiring is clear and debuggable
- **Trigger**: When service count exceeds ~15 or initialization ordering becomes painful

## IPC Rate Limiting
- No rate limiting on IPC calls from renderer
- Rapid calls could theoretically degrade main process performance
- **Why deferred**: Not a real-world issue currently, renderer is trusted code
- **Trigger**: If adding user-facing API or extension system
