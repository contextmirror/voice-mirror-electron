# Contributing to Voice Mirror

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

```bash
git clone https://github.com/contextmirror/voice-mirror-electron.git
cd voice-mirror-electron
npm install
cd mcp-server && npm install && cd ..
cd python && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
npm start
```

## Development Workflow

1. Fork the repo and create a branch from `dev`
2. Make your changes
3. Run `npm test` — all 519+ tests must pass
4. Open a PR against `dev` (not `main`)

## Code Standards

### JavaScript (Electron / MCP Server)

- **Services** use the factory pattern: `createXxx()` returning `{ start(), stop(), isRunning() }`
- **IPC handlers** return `{ success: boolean, data?: any, error?: string }`
- **Logging** via `createLogger()` — no raw `console.log` in Electron code
- **MCP tool responses** return `{ ok: boolean, action: string, result?: any, error?: string }`

### Python (Voice Backend)

- Python 3.9+ required
- Code lives in `python/` with its own virtual environment
- Changes to the Python backend should consider the `inbox.json` bridge shared with Electron

### General

- Keep changes focused — one feature or fix per PR
- Add tests for new functionality (`test/unit/` or `test/integration/`)
- Don't introduce new dependencies without justification
- Avoid over-engineering — simple and focused beats clever and abstract

## Testing

```bash
npm test                              # all tests
node --test test/unit/foo.test.js     # single file
```

Tests are source-inspection style using `node:test` and `node:assert/strict`. They verify structure, exports, and behavior without requiring a running Electron instance.

## Reporting Bugs

- Use [GitHub Issues](https://github.com/contextmirror/voice-mirror-electron/issues)
- Include: steps to reproduce, expected vs actual behavior, platform (Linux/macOS/Windows)

## Security Vulnerabilities

Do **not** open public issues for security bugs. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
