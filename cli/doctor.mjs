/**
 * Voice Mirror CLI — Health check command
 */

import chalk from 'chalk';
import {
    getNodeVersion,
    detectPython,
    detectPlatform,
    detectOllama,
    detectClaudeCli,
    detectPythonVenv,
    checkPipRequirements,
    detectWakeWordModel,
    detectTTSModel,
    detectMCPServerDeps,
    readExistingConfig,
    getConfigPath,
} from './checks.mjs';
import { detectFfmpeg } from './python-setup.mjs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');

function pass(msg) { console.log(`  ${chalk.green('✓')} ${msg}`); }
function fail(msg, hint) {
    console.log(`  ${chalk.red('✗')} ${msg}`);
    if (hint) console.log(`    ${chalk.dim(hint)}`);
}
function warn(msg) { console.log(`  ${chalk.yellow('!')} ${msg}`); }

export async function runDoctor() {
    console.log();
    console.log(chalk.bold.magenta('◉ System Health Check'));
    console.log();

    let issues = 0;

    // Node.js
    const nodeVer = getNodeVersion();
    const nodeMajor = parseInt(nodeVer);
    if (nodeMajor >= 18) {
        pass(`Node.js ${nodeVer}`);
    } else {
        fail(`Node.js ${nodeVer} (need 18+)`);
        issues++;
    }

    // Platform
    const plat = detectPlatform();
    pass(`Platform: ${plat.os}/${plat.arch} (${plat.display})`);

    // Python
    const python = detectPython();
    if (python) {
        pass(`Python ${python.version}`);
    } else {
        fail('Python 3 not found', 'Install Python 3.9+ and ensure it\'s on PATH');
        issues++;
    }

    // Python venv
    const venv = detectPythonVenv(PROJECT_DIR);
    if (venv.exists && venv.binExists) {
        pass('Python venv exists');

        // Pip requirements
        const pip = checkPipRequirements(venv.binary, PROJECT_DIR);
        if (pip.ok) {
            pass('pip requirements installed');
        } else {
            fail('pip requirements missing', `Run: ${venv.binary} -m pip install -r python/requirements.txt`);
            issues++;
        }
    } else {
        fail('Python venv not found', 'Run: voice-mirror setup');
        issues++;
    }

    // Claude CLI
    if (detectClaudeCli()) {
        pass('Claude CLI available');
    } else {
        warn('Claude CLI not installed (optional — needed for Claude Code provider)');
    }

    // Ollama
    const ollama = await detectOllama();
    if (ollama.installed) {
        if (ollama.running) {
            const models = ollama.models.length > 0
                ? ollama.models.slice(0, 5).join(', ')
                : 'no models';
            pass(`Ollama running (${models})`);

            // Check for recommended model
            const hasRecommended = ollama.models.some(m => m.startsWith('llama3.1'));
            if (!hasRecommended) {
                warn('Recommended model llama3.1:8b not found (run: ollama pull llama3.1:8b)');
            }
        } else {
            warn('Ollama installed but not running (run: ollama serve)');
        }
    } else {
        warn('Ollama not installed (optional — needed for local LLM)');
    }

    // Wake word model
    if (detectWakeWordModel(PROJECT_DIR)) {
        pass('Wake word model found');
    } else {
        fail('Wake word model missing', 'Expected at python/models/hey_claude_v2.onnx');
        issues++;
    }

    // TTS model
    if (detectTTSModel(PROJECT_DIR)) {
        pass('TTS model found (Kokoro)');
    } else {
        fail('TTS model missing', 'Expected at python/kokoro-v1.0.onnx');
        issues++;
    }

    // MCP server deps
    if (detectMCPServerDeps(PROJECT_DIR)) {
        pass('MCP server dependencies installed');
    } else {
        fail('MCP server deps missing', 'Run: cd mcp-server && npm install');
        issues++;
    }

    // ffmpeg
    if (detectFfmpeg()) {
        pass('ffmpeg available (voice cloning)');
    } else {
        warn('ffmpeg not installed (optional — needed for voice cloning)');
    }

    // Config
    const configPath = getConfigPath();
    const config = readExistingConfig(configPath);
    if (config) {
        const provider = config.ai?.provider || 'claude';
        pass(`Config valid (provider: ${provider})`);
    } else {
        warn('No config found (run: voice-mirror setup)');
    }

    console.log();
    if (issues === 0) {
        console.log(chalk.green.bold('  All checks passed!'));
    } else {
        console.log(chalk.yellow(`  ${issues} issue${issues > 1 ? 's' : ''} found. Run voice-mirror setup to fix.`));
    }
    console.log();

    return issues;
}
