/**
 * Build a filtered environment for spawned PTY processes.
 *
 * Instead of forwarding the entire process.env (which may contain secrets,
 * tokens, cloud credentials, etc.), we allowlist only the variables that
 * CLI tools actually need to function.
 *
 * @param {Object} [overrides] - Extra env vars to merge on top
 * @returns {Object} Filtered environment object
 */
function buildFilteredEnv(overrides = {}) {
    const env = {};

    // Exact-match keys to forward
    const ALLOWED_KEYS = [
        // Path & shell basics
        'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
        'SHELL', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL',

        // Windows system
        'SystemRoot', 'SYSTEMROOT', 'COMSPEC',
        'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',

        // Node / app
        'NODE_ENV',

        // SSH (for git)
        'SSH_AUTH_SOCK',

        // Editor preferences
        'EDITOR', 'VISUAL',

        // Voice Mirror session flag
        'VOICE_MIRROR_SESSION',

        // Program Files paths (needed for tool resolution on Windows)
        'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
    ];

    // Prefix patterns to forward (case-insensitive match)
    const ALLOWED_PREFIXES = [
        'ANTHROPIC_',   // Anthropic API auth
        'CLAUDE_',      // Claude CLI config
        'OLLAMA_',      // Ollama config (host, models, origins)
        'OPENAI_',      // OpenAI / LM Studio / Jan API config
        'GEMINI_',      // Google Gemini API
        'MISTRAL_',     // Mistral API
        'GROQ_',        // Groq API
        'XDG_',         // Linux XDG base directories
    ];

    for (const key of ALLOWED_KEYS) {
        if (process.env[key] !== undefined) {
            env[key] = process.env[key];
        }
    }

    const upperPrefixes = ALLOWED_PREFIXES.map(p => p.toUpperCase());
    for (const key of Object.keys(process.env)) {
        const upper = key.toUpperCase();
        if (upperPrefixes.some(prefix => upper.startsWith(prefix))) {
            env[key] = process.env[key];
        }
    }

    // Merge caller-supplied overrides last (highest priority)
    Object.assign(env, overrides);

    return env;
}

module.exports = { buildFilteredEnv };
