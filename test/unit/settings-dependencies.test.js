const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Source-inspection tests for the expanded Dependencies settings tab.
 *
 * Verifies that all 3 sections (Packages, System, Python Environment)
 * are wired up correctly across IPC, preload, HTML, and renderer.
 */

const miscSource = fs.readFileSync(
    path.join(__dirname, '../../electron/ipc/misc.js'), 'utf-8'
);
const preloadSource = fs.readFileSync(
    path.join(__dirname, '../../electron/preload.js'), 'utf-8'
);
const htmlSource = fs.readFileSync(
    path.join(__dirname, '../../electron/templates/settings-dependencies.html'), 'utf-8'
);
const rendererSource = fs.readFileSync(
    path.join(__dirname, '../../electron/renderer/settings-dependencies.js'), 'utf-8'
);

// --- IPC backend (misc.js) ---

describe('Dependencies IPC - check-dependency-versions', () => {
    it('should have check-dependency-versions handler', () => {
        assert.ok(
            miscSource.includes("'check-dependency-versions'"),
            'misc.js should register check-dependency-versions IPC handler'
        );
    });

    it('should return npm section with ghosttyWeb, opencode, claudeCode', () => {
        for (const key of ['ghosttyWeb', 'opencode', 'claudeCode']) {
            assert.ok(
                miscSource.includes(key),
                `misc.js should reference npm key "${key}"`
            );
        }
    });

    it('should return system section with node, python, ollama, ffmpeg', () => {
        assert.ok(miscSource.includes('results.node'), 'misc.js should populate results.node');
        assert.ok(miscSource.includes('results.ollama'), 'misc.js should populate results.ollama');
        assert.ok(miscSource.includes('results.ffmpeg'), 'misc.js should populate results.ffmpeg');
        assert.ok(miscSource.includes('venvPython'), 'misc.js should detect Python via venv');
    });

    it('should return pip section with outdated check', () => {
        assert.ok(
            miscSource.includes('{ npm, system, pip }'),
            'misc.js should return { npm, system, pip } data shape'
        );
        assert.ok(
            miscSource.includes('--outdated'),
            'misc.js should check pip outdated packages'
        );
    });
});

describe('Dependencies IPC - update-dependency ALLOWED whitelist', () => {
    it('should allow ghostty-web updates', () => {
        assert.ok(
            miscSource.includes("'ghostty-web'"),
            'ALLOWED whitelist should include ghostty-web'
        );
    });

    it('should allow opencode updates', () => {
        assert.ok(
            miscSource.includes("'opencode'"),
            'ALLOWED whitelist should include opencode'
        );
    });

    it('should allow claude-code updates', () => {
        assert.ok(
            miscSource.includes("'claude-code'"),
            'ALLOWED whitelist should include claude-code'
        );
    });

    it('should reference @anthropic-ai/claude-code package', () => {
        assert.ok(
            miscSource.includes('@anthropic-ai/claude-code'),
            'misc.js should reference the full scoped package name'
        );
    });
});

describe('Dependencies IPC - update-pip-packages handler', () => {
    it('should have update-pip-packages IPC handler', () => {
        assert.ok(
            miscSource.includes("'update-pip-packages'"),
            'misc.js should register update-pip-packages handler'
        );
    });

    it('should run pip install with --upgrade flag', () => {
        assert.ok(
            miscSource.includes('--upgrade'),
            'update-pip-packages should use --upgrade flag'
        );
    });
});

// --- Preload bridge ---

describe('Dependencies preload bridge', () => {
    it('should expose checkDependencyVersions', () => {
        assert.ok(
            preloadSource.includes('checkDependencyVersions'),
            'preload.js should expose checkDependencyVersions'
        );
    });

    it('should expose updateDependency', () => {
        assert.ok(
            preloadSource.includes('updateDependency'),
            'preload.js should expose updateDependency'
        );
    });

    it('should expose updatePipPackages', () => {
        assert.ok(
            preloadSource.includes('updatePipPackages'),
            'preload.js should expose updatePipPackages'
        );
    });

    it('should reference update-pip-packages IPC channel', () => {
        assert.ok(
            preloadSource.includes('update-pip-packages'),
            'preload.js should invoke update-pip-packages IPC'
        );
    });
});

// --- HTML template ---

describe('Dependencies HTML - Packages section', () => {
    it('should have ghostty card elements', () => {
        for (const id of ['dep-ghostty-installed', 'dep-ghostty-latest', 'dep-ghostty-badge', 'dep-ghostty-update']) {
            assert.ok(htmlSource.includes(`id="${id}"`), `HTML should contain ${id}`);
        }
    });

    it('should have opencode card elements', () => {
        for (const id of ['dep-opencode-installed', 'dep-opencode-latest', 'dep-opencode-badge', 'dep-opencode-update']) {
            assert.ok(htmlSource.includes(`id="${id}"`), `HTML should contain ${id}`);
        }
    });

    it('should have claude card elements', () => {
        for (const id of ['dep-claude-installed', 'dep-claude-latest', 'dep-claude-badge', 'dep-claude-update']) {
            assert.ok(htmlSource.includes(`id="${id}"`), `HTML should contain ${id}`);
        }
    });

    it('should have npm Update All button', () => {
        assert.ok(
            htmlSource.includes('id="dep-npm-update-all"'),
            'HTML should have npm Update All button'
        );
    });
});

describe('Dependencies HTML - System section', () => {
    it('should have node system card', () => {
        assert.ok(htmlSource.includes('id="dep-node-version"'), 'HTML should have node version element');
        assert.ok(htmlSource.includes('id="dep-node-badge"'), 'HTML should have node badge element');
    });

    it('should have python system card', () => {
        assert.ok(htmlSource.includes('id="dep-python-version"'), 'HTML should have python version element');
        assert.ok(htmlSource.includes('id="dep-python-badge"'), 'HTML should have python badge element');
    });

    it('should have ollama system card', () => {
        assert.ok(htmlSource.includes('id="dep-ollama-version"'), 'HTML should have ollama version element');
        assert.ok(htmlSource.includes('id="dep-ollama-badge"'), 'HTML should have ollama badge element');
    });

    it('should have ffmpeg system card', () => {
        assert.ok(htmlSource.includes('id="dep-ffmpeg-version"'), 'HTML should have ffmpeg version element');
        assert.ok(htmlSource.includes('id="dep-ffmpeg-badge"'), 'HTML should have ffmpeg badge element');
    });

    it('should use compact card style for system cards', () => {
        assert.ok(
            htmlSource.includes('dep-card-compact'),
            'System cards should use dep-card-compact class'
        );
    });
});

describe('Dependencies HTML - Python Environment section', () => {
    it('should have pip summary badge', () => {
        assert.ok(htmlSource.includes('id="dep-pip-summary"'), 'HTML should have pip summary element');
    });

    it('should have pip table container', () => {
        assert.ok(htmlSource.includes('id="dep-pip-table-container"'), 'HTML should have pip table container');
    });

    it('should have pip table body for outdated packages', () => {
        assert.ok(htmlSource.includes('id="dep-pip-tbody"'), 'HTML should have pip tbody element');
    });

    it('should have pip Update All button', () => {
        assert.ok(htmlSource.includes('id="dep-pip-update-all"'), 'HTML should have pip Update All button');
    });

    it('should have pip table headers (Package, Installed, Latest)', () => {
        assert.ok(htmlSource.includes('<th>Package</th>'), 'pip table should have Package header');
        assert.ok(htmlSource.includes('<th>Installed</th>'), 'pip table should have Installed header');
        assert.ok(htmlSource.includes('<th>Latest</th>'), 'pip table should have Latest header');
    });
});

describe('Dependencies HTML - Check for Updates', () => {
    it('should have check button', () => {
        assert.ok(htmlSource.includes('id="dep-check-btn"'), 'HTML should have check button');
    });

    it('should have last-checked timestamp element', () => {
        assert.ok(htmlSource.includes('id="dep-last-checked"'), 'HTML should have last-checked element');
    });
});

// --- Renderer JS ---

describe('Dependencies renderer - exports', () => {
    it('should export initDependenciesTab', () => {
        assert.ok(
            rendererSource.includes('export function initDependenciesTab'),
            'renderer should export initDependenciesTab'
        );
    });

    it('should export loadDependenciesUI', () => {
        assert.ok(
            rendererSource.includes('export async function loadDependenciesUI'),
            'renderer should export loadDependenciesUI'
        );
    });
});

describe('Dependencies renderer - npm update handling', () => {
    it('should have updateCard function for npm cards', () => {
        assert.ok(
            rendererSource.includes('function updateCard('),
            'renderer should have updateCard function'
        );
    });

    it('should have handleNpmUpdateAll function', () => {
        assert.ok(
            rendererSource.includes('function handleNpmUpdateAll'),
            'renderer should have handleNpmUpdateAll function'
        );
    });

    it('should have NPM_UPDATE_MAP with all 3 packages', () => {
        assert.ok(rendererSource.includes('NPM_UPDATE_MAP'), 'renderer should define NPM_UPDATE_MAP');
        assert.ok(rendererSource.includes('ghosttyWeb'), 'NPM_UPDATE_MAP should include ghosttyWeb');
        assert.ok(rendererSource.includes('opencode'), 'NPM_UPDATE_MAP should include opencode');
        assert.ok(rendererSource.includes('claudeCode'), 'NPM_UPDATE_MAP should include claudeCode');
    });
});

describe('Dependencies renderer - system card handling', () => {
    it('should have updateSystemCard function', () => {
        assert.ok(
            rendererSource.includes('function updateSystemCard('),
            'renderer should have updateSystemCard function'
        );
    });

    it('should check all 4 system tools in checkVersions', () => {
        for (const tool of ['node', 'python', 'ollama', 'ffmpeg']) {
            assert.ok(
                rendererSource.includes(`'${tool}'`),
                `checkVersions should handle ${tool} system card`
            );
        }
    });
});

describe('Dependencies renderer - pip handling', () => {
    it('should have updatePipSection function', () => {
        assert.ok(
            rendererSource.includes('function updatePipSection('),
            'renderer should have updatePipSection function'
        );
    });

    it('should have handlePipUpdateAll function', () => {
        assert.ok(
            rendererSource.includes('function handlePipUpdateAll'),
            'renderer should have handlePipUpdateAll function'
        );
    });

    it('should have escapeHtml function for XSS safety', () => {
        assert.ok(
            rendererSource.includes('function escapeHtml('),
            'renderer should have escapeHtml helper'
        );
    });
});

// --- CSS ---

describe('Dependencies CSS', () => {
    it('should define dep-section styles', () => {
        assert.ok(htmlSource.includes('.dep-section'), 'CSS should have .dep-section');
    });

    it('should define dep-card-compact styles', () => {
        assert.ok(htmlSource.includes('.dep-card-compact'), 'CSS should have .dep-card-compact');
    });

    it('should define dep-pip-table styles', () => {
        assert.ok(htmlSource.includes('.dep-pip-table'), 'CSS should have .dep-pip-table');
    });

    it('should define dep-update-all-btn styles', () => {
        assert.ok(htmlSource.includes('.dep-update-all-btn'), 'CSS should have .dep-update-all-btn');
    });

    it('should have badge states: up-to-date, update-available, not-installed, error, checking', () => {
        for (const state of ['up-to-date', 'update-available', 'not-installed', 'error', 'checking']) {
            assert.ok(
                htmlSource.includes(`.dep-badge.${state}`),
                `CSS should have .dep-badge.${state} style`
            );
        }
    });
});
