# electron/providers/

AI provider system. Supports Claude Code (PTY), generic CLI agents (PTY),
and OpenAI-compatible HTTP APIs. Factory in `index.js` creates the right
provider based on config.

## Module index

| Module | Type | Description |
|---|---|---|
| `index.js` | Factory | `createProvider(type, config)` -- routes to correct provider class |
| `base-provider.js` | Base class | Abstract EventEmitter base with `start()`, `stop()`, `isRunning()` |
| `claude-provider.js` | Provider | Claude Code wrapper -- delegates to claude-spawner for PTY |
| `claude-spawner.js` | Spawner | node-pty spawning for Claude Code CLI, MCP config, status line |
| `cli-provider.js` | Provider | Generic CLI wrapper -- OpenCode, Codex, Gemini CLI, Kimi CLI |
| `cli-spawner.js` | Spawner | node-pty spawning for generic CLI tools |
| `openai-provider.js` | Provider | HTTP streaming for OpenAI-compatible APIs (Ollama, LM Studio, cloud) |
