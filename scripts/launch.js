#!/usr/bin/env node
/**
 * Cross-platform Electron launcher for Voice Mirror.
 *
 * Replaces platform-specific shell commands in package.json scripts.
 * Handles:
 * - ELECTRON_RUN_AS_NODE unset (env -u equivalent)
 * - Linux-only flags (--ozone-platform=x11, --disable-gpu, --no-sandbox)
 * - Dev mode flag pass-through
 */

const { spawn } = require('child_process');
const path = require('path');

const isLinux = process.platform === 'linux';
const isDev = process.argv.includes('--dev');

// Ensure ELECTRON_RUN_AS_NODE is not set (equivalent to `env -u ELECTRON_RUN_AS_NODE`)
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Build Electron args
const electronArgs = ['.'];

if (isLinux) {
    electronArgs.push('--ozone-platform=x11');
    electronArgs.push('--disable-gpu');
    electronArgs.push('--no-sandbox');
}

if (isDev) {
    electronArgs.push('--dev');
}

// Find electron binary
const electronPath = require.resolve('electron/cli.js');

const child = spawn(process.execPath, [electronPath, ...electronArgs], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env
});

child.on('close', (code) => {
    process.exit(code || 0);
});
