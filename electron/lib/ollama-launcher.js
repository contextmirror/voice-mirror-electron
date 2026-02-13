/**
 * Ollama server launcher for Voice Mirror Electron.
 * Ensures Ollama is running before starting AI providers that depend on it.
 */

const path = require('path');
const fs = require('fs');
const { DEFAULT_ENDPOINTS } = require('../constants');
const { createLogger } = require('../services/logger');
const logger = createLogger();

/**
 * Start the Ollama server process.
 * Finds the ollama executable and spawns it in detached mode.
 * @param {Object} appConfig - Application config (for endpoint overrides)
 */
async function startOllamaServer(appConfig) {
    const { spawn: spawnDetached, execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const os = require('os');

    // Find ollama executable (async to avoid blocking main thread)
    let ollamaPath = null;
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execFileAsync(cmd, ['ollama'], { encoding: 'utf8' });
        ollamaPath = stdout.trim().split('\n')[0];
    } catch {
        // Not on PATH — check common locations
        const candidates = [];
        if (process.platform === 'win32') {
            candidates.push(
                path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
                path.join(path.dirname(path.dirname(__dirname)), 'Ollama', 'ollama.exe')
            );
            if (process.env.OLLAMA_MODELS) {
                candidates.push(path.join(path.dirname(process.env.OLLAMA_MODELS), 'ollama.exe'));
            }
        } else if (process.platform === 'darwin') {
            candidates.push(
                '/usr/local/bin/ollama',
                path.join(os.homedir(), '.ollama', 'ollama'),
                '/Applications/Ollama.app/Contents/Resources/ollama'
            );
        } else {
            candidates.push(
                '/usr/local/bin/ollama',
                '/usr/bin/ollama',
                path.join(os.homedir(), '.ollama', 'ollama')
            );
        }
        for (const c of candidates) {
            if (fs.existsSync(c)) { ollamaPath = c; break; }
        }
    }

    if (!ollamaPath) {
        logger.info('[Ollama]', 'Could not find ollama executable');
        return;
    }

    logger.info('[Ollama]', `Starting server: ${ollamaPath}`);
    const env = { ...process.env };
    // Preserve OLLAMA_MODELS if set (custom model directory)
    const proc = spawnDetached(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        env
    });
    proc.unref();
}

/**
 * Ensure a local LLM server (Ollama) is running before the AI provider starts.
 * On Windows, Ollama may not auto-start if installed to a custom directory.
 * @param {string} providerName - The provider name (only acts on 'ollama')
 * @param {Object} appConfig - Application config
 */
function ensureLocalLLMRunning(providerName, appConfig) {
    if (providerName !== 'ollama') return;

    // Check if Ollama is already responding
    try {
        const endpoint = appConfig?.ai?.endpoints?.ollama || DEFAULT_ENDPOINTS.ollama;
        // Quick sync check — just see if the port is open
        require('net').createConnection({ port: new URL(endpoint).port || 11434, host: '127.0.0.1' })
            .on('connect', function() { this.destroy(); })
            .on('error', () => {
                // Not running — try to start it
                logger.info('[Ollama]', 'Not running, attempting to start...');
                startOllamaServer(appConfig);
            });
    } catch {
        startOllamaServer(appConfig);
    }
}

module.exports = { startOllamaServer, ensureLocalLLMRunning };
