/**
 * Voice Mirror CLI — Ollama detection, installation, and model pulling
 */

import { execSync, spawn } from 'child_process';
import { platform, homedir } from 'os';
import { join } from 'path';
import { existsSync, createWriteStream, unlinkSync } from 'fs';
import { get as httpsGet } from 'https';
import { detectOllama, commandExists } from './checks.mjs';

/**
 * Find winget on Windows — it may not be on PATH in child processes.
 */
function findWinget() {
    if (commandExists('winget')) return 'winget';
    const wingetPath = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe');
    if (existsSync(wingetPath)) return wingetPath;
    return null;
}

/**
 * Download a file from URL to dest path. Returns a promise.
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const follow = (url) => {
            httpsGet(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    return;
                }
                const file = createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', reject);
            }).on('error', reject);
        };
        follow(url);
    });
}

const RECOMMENDED_MODELS = [
    { value: 'llama3.1:8b', label: 'llama3.1:8b (Recommended)', hint: '4.9GB — best speed/accuracy (98% browser benchmark)' },
    { value: 'qwen3:8b', label: 'qwen3:8b', hint: '5.2GB — strong reasoning' },
    { value: 'gemma3:12b', label: 'gemma3:12b', hint: '8.1GB — needs more VRAM' },
];

const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Install Ollama on the system.
 * Returns true if successful.
 */
export async function installOllama(spinner) {
    const os = platform();

    if (os === 'linux') {
        spinner.update('Installing Ollama via official script...');
        try {
            execSync('curl -fsSL https://ollama.ai/install.sh | sh', {
                stdio: 'pipe',
                timeout: 120000,
            });
            return true;
        } catch (err) {
            return false;
        }
    }

    if (os === 'darwin') {
        if (commandExists('brew')) {
            spinner.update('Installing Ollama via Homebrew...');
            try {
                execSync('brew install ollama', { stdio: 'pipe', timeout: 120000 });
                return true;
            } catch {
                return false;
            }
        }
    }

    if (os === 'win32') {
        // Try winget first (with full path detection)
        const winget = findWinget();
        if (winget) {
            spinner.update('Installing Ollama via winget...');
            try {
                execSync(`"${winget}" install --id Ollama.Ollama --accept-source-agreements --accept-package-agreements`, {
                    stdio: 'pipe',
                    timeout: 180000,
                });
                return true;
            } catch { /* fall through to direct download */ }
        }

        // Direct download fallback
        spinner.update('Downloading Ollama installer...');
        const installerPath = join(process.env.TEMP || homedir(), 'OllamaSetup.exe');
        try {
            await downloadFile('https://ollama.com/download/OllamaSetup.exe', installerPath);
            spinner.update('Running Ollama installer...');
            execSync(`"${installerPath}" /VERYSILENT /NORESTART`, {
                stdio: 'pipe',
                timeout: 180000,
            });
            try { unlinkSync(installerPath); } catch {}
            // Refresh PATH for this process
            const newPath = process.env.LOCALAPPDATA + '\\Programs\\Ollama';
            if (!process.env.PATH.includes(newPath)) {
                process.env.PATH = newPath + ';' + process.env.PATH;
            }
            return commandExists('ollama');
        } catch {
            try { unlinkSync(installerPath); } catch {}
            return false;
        }
    }

    return false;
}

/**
 * Start Ollama server if not running.
 */
export async function ensureOllamaRunning(spinner) {
    const status = await detectOllama();
    if (status.running) return true;

    if (!status.installed) return false;

    spinner.update('Starting Ollama server...');
    // Spawn detached so it survives
    const proc = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
    });
    proc.unref();

    // Wait for it to become reachable
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const resp = await fetch('http://localhost:11434/api/tags');
            if (resp.ok) return true;
        } catch { /* not yet */ }
    }
    return false;
}

/**
 * Pull a model with progress tracking.
 * Returns true if successful.
 */
export async function pullModel(modelName, spinner) {
    spinner.update(`Pulling ${modelName}...`);

    return new Promise((resolve) => {
        const proc = spawn('ollama', ['pull', modelName], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let lastUpdate = 0;
        proc.stderr.on('data', (data) => {
            const line = data.toString().trim();
            // Ollama outputs progress like "pulling abc123... 45% ▕████░░░░░░░░░░░░▏ 2.1 GB/4.9 GB"
            const now = Date.now();
            if (now - lastUpdate > 500) { // throttle updates
                const match = line.match(/(\d+)%/);
                if (match) {
                    spinner.update(`Pulling ${modelName}... ${match[1]}%`);
                }
                lastUpdate = now;
            }
        });

        proc.stdout.on('data', (data) => {
            const line = data.toString().trim();
            const now = Date.now();
            if (now - lastUpdate > 500) {
                const match = line.match(/(\d+)%/);
                if (match) {
                    spinner.update(`Pulling ${modelName}... ${match[1]}%`);
                }
                lastUpdate = now;
            }
        });

        proc.on('close', (code) => {
            resolve(code === 0);
        });

        proc.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Pull the embedding model for memory system.
 */
export async function pullEmbeddingModel(spinner) {
    return pullModel(EMBEDDING_MODEL, spinner);
}

/**
 * Verify a model works by running a quick test.
 */
export async function verifyModel(modelName) {
    try {
        const resp = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: 'Say "ok" and nothing else.',
                stream: false,
                options: { num_predict: 5 },
            }),
        });
        return resp.ok;
    } catch {
        return false;
    }
}

/**
 * Check if a specific model is already pulled.
 */
export async function hasModel(modelName) {
    const status = await detectOllama();
    if (!status.running) return false;
    // Normalize: "llama3.1:8b" matches "llama3.1:8b"
    return status.models.some(m => m === modelName || m.startsWith(modelName.split(':')[0]));
}

export { RECOMMENDED_MODELS, EMBEDDING_MODEL };
