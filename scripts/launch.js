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
const { existsSync } = require('fs');
const path = require('path');

const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
const isDev = process.argv.includes('--dev');
const projectDir = path.join(__dirname, '..');

// Pre-flight checks: verify critical dependencies exist before launching Electron
const venvPython = isWindows
    ? path.join(projectDir, 'python', '.venv', 'Scripts', 'python.exe')
    : path.join(projectDir, 'python', '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
    console.error('\n❌ Python virtual environment not found.');
    console.error(`   Expected: ${venvPython}`);
    console.error('\n   Run setup first:  node cli/index.mjs setup');
    console.error('   Or on Windows:    .\\install.ps1\n');
    process.exit(1);
}

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
