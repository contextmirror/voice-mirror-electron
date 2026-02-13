/**
 * Shared constants for Voice Mirror Electron (main process).
 *
 * Single source of truth for values duplicated across modules.
 */

// CLI agent providers that use PTY mode (not HTTP API)
const CLI_PROVIDERS = ['claude', 'opencode'];

// Default endpoint URLs for local LLM providers
const DEFAULT_ENDPOINTS = {
    ollama: 'http://127.0.0.1:11434',
    lmstudio: 'http://127.0.0.1:1234',
    jan: 'http://127.0.0.1:1337',
};

module.exports = {
    CLI_PROVIDERS,
    DEFAULT_ENDPOINTS,
};
