/**
 * settings-dependencies.js — Dependencies settings tab sub-module
 *
 * Shows installed vs latest versions for ghostty-web and OpenCode.
 * Hidden behind advanced.showDependencies feature flag.
 */

import { createLog } from './log.js';
const log = createLog('[Settings:Deps]');

let lastChecked = null;

function setBadge(el, cls, text) {
    el.className = 'dep-badge ' + cls;
    el.textContent = text;
}

function updateCard(prefix, info) {
    const installedEl = document.getElementById(`dep-${prefix}-installed`);
    const latestEl = document.getElementById(`dep-${prefix}-latest`);
    const badgeEl = document.getElementById(`dep-${prefix}-badge`);
    const updateBtn = document.getElementById(`dep-${prefix}-update`);

    if (!installedEl || !badgeEl) return;

    latestEl.textContent = info.latest || '--';

    if (info.error) {
        installedEl.textContent = '--';
        setBadge(badgeEl, 'error', info.error);
        updateBtn.style.display = 'none';
        return;
    }

    if (info.notInstalled) {
        installedEl.textContent = 'Not installed';
        setBadge(badgeEl, 'not-installed', 'Not installed');
        updateBtn.style.display = 'none';
        return;
    }

    installedEl.textContent = info.installed || '--';

    if (info.updateAvailable) {
        setBadge(badgeEl, 'update-available', 'Update available');
        updateBtn.style.display = '';
    } else {
        setBadge(badgeEl, 'up-to-date', 'Up to date');
        updateBtn.style.display = 'none';
    }
}

async function checkVersions() {
    const checkBtn = document.getElementById('dep-check-btn');
    const lastCheckedEl = document.getElementById('dep-last-checked');

    // Set checking state
    ['ghostty', 'opencode'].forEach(prefix => {
        const badge = document.getElementById(`dep-${prefix}-badge`);
        if (badge) setBadge(badge, 'checking', 'Checking...');
    });
    if (checkBtn) checkBtn.disabled = true;

    try {
        const result = await window.voiceMirror.ai.checkDependencyVersions();

        if (result.success && result.data) {
            if (result.data.ghosttyWeb) updateCard('ghostty', result.data.ghosttyWeb);
            if (result.data.opencode) updateCard('opencode', result.data.opencode);
        }

        lastChecked = new Date();
        if (lastCheckedEl) {
            lastCheckedEl.textContent = `Last checked: just now`;
        }
    } catch (err) {
        log.error('Version check failed:', err);
    } finally {
        if (checkBtn) checkBtn.disabled = false;
    }
}

async function handleUpdate(depId, prefix) {
    const updateBtn = document.getElementById(`dep-${prefix}-update`);
    const badgeEl = document.getElementById(`dep-${prefix}-badge`);
    if (!updateBtn || !badgeEl) return;

    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';
    setBadge(badgeEl, 'checking', 'Installing...');

    try {
        const result = await window.voiceMirror.ai.updateDependency(depId);

        if (result.success) {
            setBadge(badgeEl, 'up-to-date', 'Updated!');
            updateBtn.style.display = 'none';
            // Refresh versions after update
            setTimeout(() => checkVersions(), 1000);
        } else {
            setBadge(badgeEl, 'error', 'Update failed');
            updateBtn.textContent = 'Retry';
            updateBtn.disabled = false;
        }
    } catch (err) {
        log.error(`Update failed for ${depId}:`, err);
        setBadge(badgeEl, 'error', 'Update failed');
        updateBtn.textContent = 'Retry';
        updateBtn.disabled = false;
    }
}

/**
 * Initialize Dependencies tab — attach event listeners
 */
export function initDependenciesTab() {
    // Update buttons
    const ghosttyBtn = document.getElementById('dep-ghostty-update');
    const opencodeBtn = document.getElementById('dep-opencode-update');

    if (ghosttyBtn) {
        ghosttyBtn.addEventListener('click', () => handleUpdate('ghostty-web', 'ghostty'));
    }
    if (opencodeBtn) {
        opencodeBtn.addEventListener('click', () => handleUpdate('opencode', 'opencode'));
    }

    // Expose check function globally for onclick
    window.checkDependencyUpdates = checkVersions;

    log.info('Dependencies tab initialized');
}

/**
 * Load Dependencies UI — check versions on tab load
 */
export async function loadDependenciesUI() {
    await checkVersions();
}
