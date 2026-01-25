/**
 * Claude Code Spawner for Voice Mirror Electron
 *
 * Uses --print mode to get single responses.
 * Electron handles the loop by watching the inbox.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Path to MCP server
const MCP_SERVER_PATH = path.join(__dirname, '..', 'mcp-server', 'index.js');

// Claude settings directory
const CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.claude');
const MCP_SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'mcp_settings.json');

// Voice Mirror working directory
const VOICE_MIRROR_DIR = path.join(__dirname, '..', 'python');

// Data directory
const DATA_DIR = path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
const INBOX_PATH = path.join(DATA_DIR, 'inbox.json');

/**
 * System prompt for Voice Mirror's Claude (concise for --print mode)
 */
const VOICE_CLAUDE_SYSTEM = `You are Voice Mirror's Claude - a voice-controlled AI assistant.
You receive voice transcriptions and respond conversationally.
Keep responses SHORT (1-3 sentences) since they will be spoken aloud.
No markdown, bullets, or code blocks - just plain speech.
Be helpful and conversational.`;

/**
 * Configure MCP server for Claude Code
 */
function configureMCPServer() {
    // Ensure .claude directory exists
    if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
        fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    }

    // Load existing settings or create new
    let settings = { mcpServers: {} };
    if (fs.existsSync(MCP_SETTINGS_PATH)) {
        try {
            settings = JSON.parse(fs.readFileSync(MCP_SETTINGS_PATH, 'utf-8'));
        } catch {}
    }

    // Add/update voice-mirror-electron server
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers['voice-mirror-electron'] = {
        command: 'node',
        args: [MCP_SERVER_PATH],
        env: {}
    };

    fs.writeFileSync(MCP_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[Claude Spawner] MCP settings configured');
}

/**
 * Check if Claude CLI is available
 */
function isClaudeAvailable() {
    const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    try {
        const { execSync } = require('child_process');
        execSync(`${claudePath} --version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Send a single message to Claude and get a response (--print mode)
 */
function askClaude(message, options = {}) {
    return new Promise((resolve, reject) => {
        const {
            onOutput = () => {},
            timeout = 60000
        } = options;

        if (!isClaudeAvailable()) {
            reject(new Error('Claude CLI not found'));
            return;
        }

        const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude';

        // Build the prompt with context
        const prompt = `${message}`;

        console.log('[Claude] Asking:', prompt.slice(0, 100) + '...');

        const claudeProcess = spawn(claudePath, [
            '--print',
            '--dangerously-skip-permissions',
            '-p', VOICE_CLAUDE_SYSTEM,
            prompt
        ], {
            cwd: VOICE_MIRROR_DIR,
            env: {
                ...process.env,
                FORCE_COLOR: '0'  // No colors in --print mode
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        claudeProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            onOutput(chunk);
        });

        claudeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutId = setTimeout(() => {
            claudeProcess.kill();
            reject(new Error('Claude response timed out'));
        }, timeout);

        claudeProcess.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                // Clean up the response (remove any ANSI codes)
                const cleanResponse = stdout
                    .replace(/\x1B\[[0-9;]*[mK]/g, '')  // Remove ANSI codes
                    .trim();
                resolve(cleanResponse);
            } else {
                reject(new Error(`Claude exited with code ${code}: ${stderr}`));
            }
        });

        claudeProcess.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

/**
 * Write a response to the inbox
 */
function writeResponseToInbox(message) {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing messages
    let data = { messages: [] };
    if (fs.existsSync(INBOX_PATH)) {
        try {
            data = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
            if (!data.messages) data.messages = [];
        } catch {}
    }

    // Create new message
    const newMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'voice-claude',
        message: message,
        timestamp: new Date().toISOString(),
        read_by: [],
        thread_id: 'voice-mirror'
    };

    data.messages.push(newMessage);

    // Keep last 100 messages
    if (data.messages.length > 100) {
        data.messages = data.messages.slice(-100);
    }

    fs.writeFileSync(INBOX_PATH, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[Claude] Response written to inbox');

    return newMessage;
}

/**
 * Process a voice message - ask Claude and write response
 */
async function processVoiceMessage(message) {
    try {
        const response = await askClaude(message, {
            onOutput: (chunk) => console.log('[Claude output]', chunk)
        });

        if (response) {
            writeResponseToInbox(response);
            return response;
        }
        return null;
    } catch (err) {
        console.error('[Claude] Error processing message:', err.message);
        return null;
    }
}

// Legacy exports for compatibility
function spawnClaude(options = {}) {
    // Configure MCP server
    configureMCPServer();

    // Return a dummy object - actual processing happens via processVoiceMessage
    console.log('[Claude Spawner] Claude ready (--print mode)');
    return { dummy: true };
}

function stopClaude(process) {
    // No persistent process in --print mode
}

module.exports = {
    spawnClaude,
    stopClaude,
    configureMCPServer,
    isClaudeAvailable,
    askClaude,
    processVoiceMessage,
    writeResponseToInbox,
    VOICE_CLAUDE_SYSTEM
};
