<script>
  /**
   * ExtensionsSettings.svelte -- Browser extensions manager (Tier 3).
   *
   * Lists installed WebView2 extensions with enable/disable + remove, installs
   * from an unpacked folder, and offers blessed one-click installs (uBlock
   * Origin, React DevTools) via the Chrome Web Store CRX endpoint.
   *
   * The extensions profile is reached through an open browser tab, so most
   * actions require the Lens browser to have at least one tab open. If the
   * environment flag was only just enabled, WebView2 reports "not supported"
   * until the app is restarted — we surface that as a clear banner.
   */
  import Button from '../shared/Button.svelte';
  import Toggle from '../shared/Toggle.svelte';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { browserExtensionsStore } from '../../lib/stores/browser-extensions.svelte.js';
  import {
    lensExtensionsList,
    lensExtensionAdd,
    lensExtensionInstallCrx,
    lensExtensionSetEnabled,
    lensExtensionRemove,
  } from '../../lib/api.js';

  // Blessed one-click installs. CRX endpoint follows a redirect to the packed
  // extension; the backend strips the CRX header and unpacks the zip.
  const CRX_ENDPOINT = 'https://clients2.google.com/service/update2/crx';
  const crxUrl = (id) =>
    `${CRX_ENDPOINT}?response=redirect&prodversion=131.0.0.0&acceptformat=crx3&x=id%3D${id}%26uc`;
  const BLESSED = [
    {
      id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
      name: 'uBlock Origin',
      description: 'Efficient, wide-spectrum content blocker. Works headless.',
    },
    {
      id: 'fmkadmapgofadopljbjfkapdkoienihi',
      name: 'React Developer Tools',
      description: 'Inspect the React component tree inside App Preview.',
    },
  ];

  let extensions = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  // Set when WebView2 reports extensions aren't available (needs a restart) or
  // when no browser tab is open to reach the profile.
  let notice = $state('');

  function applyResult(res, successMsg) {
    if (res?.success) {
      if (Array.isArray(res.data?.extensions)) {
        extensions = res.data.extensions;
        // Keep the toolbar's buttons in sync with what settings just changed.
        browserExtensionsStore.set(extensions);
        window.dispatchEvent(new CustomEvent('lens-extensions-changed'));
      }
      notice = '';
      if (successMsg) toastStore.addToast({ message: successMsg, severity: 'success' });
      return true;
    }
    const err = res?.error || 'Unknown error';
    // Distinguish "restart needed / no tab" (a soft, expected state) from a hard failure.
    if (/restart|not supported|open a browser tab/i.test(err)) {
      notice = err;
    } else {
      toastStore.addToast({ message: err, severity: 'error' });
    }
    return false;
  }

  async function refresh() {
    loading = true;
    try {
      const res = await lensExtensionsList();
      applyResult(res);
    } catch (e) {
      notice = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
  });

  async function installFromFolder() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        title: 'Choose an unpacked extension folder',
      });
      if (!selected) return;
      busy = true;
      const res = await lensExtensionAdd(selected);
      applyResult(res, 'Extension installed');
    } catch (e) {
      toastStore.addToast({ message: `Install failed: ${e}`, severity: 'error' });
    } finally {
      busy = false;
    }
  }

  async function installBlessed(entry) {
    busy = true;
    try {
      const res = await lensExtensionInstallCrx(crxUrl(entry.id));
      applyResult(res, `${entry.name} installed`);
    } catch (e) {
      toastStore.addToast({ message: `Install failed: ${e}`, severity: 'error' });
    } finally {
      busy = false;
    }
  }

  async function toggleEnabled(ext, enabled) {
    busy = true;
    try {
      const res = await lensExtensionSetEnabled(ext.id, enabled);
      applyResult(res);
    } catch (e) {
      toastStore.addToast({ message: `Update failed: ${e}`, severity: 'error' });
    } finally {
      busy = false;
    }
  }

  async function remove(ext) {
    busy = true;
    try {
      const res = await lensExtensionRemove(ext.id);
      applyResult(res, `${ext.name} removed`);
    } catch (e) {
      toastStore.addToast({ message: `Remove failed: ${e}`, severity: 'error' });
    } finally {
      busy = false;
    }
  }

  // Which blessed extensions are already installed (dim their button).
  const installedNames = $derived(new Set(extensions.map((e) => e.name)));
</script>

<div class="extensions-settings">
  <section class="settings-section">
    <h3>Installed Extensions</h3>

    {#if notice}
      <div class="ext-notice" role="status">
        {notice}
        <button class="ext-notice-retry" onclick={refresh}>Retry</button>
      </div>
    {/if}

    <div class="settings-group">
      {#if loading}
        <p class="ext-empty">Loading…</p>
      {:else if extensions.length === 0}
        <p class="ext-empty">No extensions installed yet.</p>
      {:else}
        {#each extensions as ext (ext.id)}
          <div class="ext-row">
            <div class="ext-info">
              <span class="ext-name">{ext.name}</span>
              <span class="ext-id">{ext.id}</span>
            </div>
            <div class="ext-actions">
              <Toggle
                label=""
                checked={ext.enabled}
                disabled={busy}
                onChange={(v) => toggleEnabled(ext, v)}
              />
              <button
                class="ext-remove"
                title="Remove extension"
                aria-label="Remove {ext.name}"
                disabled={busy}
                onclick={() => remove(ext)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="ext-install-row">
      <Button small onClick={installFromFolder} disabled={busy}>
        Install from folder…
      </Button>
    </div>
  </section>

  <section class="settings-section">
    <h3>One-Click Installs</h3>
    <p class="ext-hint">
      Fetched from the Chrome Web Store and unpacked locally. Updates re-download.
    </p>
    <div class="settings-group">
      {#each BLESSED as entry (entry.id)}
        <div class="ext-row">
          <div class="ext-info">
            <span class="ext-name">{entry.name}</span>
            <span class="ext-desc">{entry.description}</span>
          </div>
          <div class="ext-actions">
            {#if installedNames.has(entry.name)}
              <span class="ext-installed">Installed</span>
            {:else}
              <Button small onClick={() => installBlessed(entry)} disabled={busy}>
                Install
              </Button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .extensions-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section h3 {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px 0;
  }

  .settings-group {
    background: var(--card-highlight);
    border-radius: var(--radius-md);
    padding: 4px;
  }

  .ext-hint {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 10px 0;
    line-height: 1.5;
  }

  .ext-empty {
    font-size: 13px;
    color: var(--muted);
    padding: 12px;
    margin: 0;
  }

  .ext-notice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 10px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
  }

  .ext-notice-retry {
    flex-shrink: 0;
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .ext-notice-retry:hover {
    background: var(--bg-elevated);
  }

  .ext-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
  }

  .ext-row + .ext-row {
    border-top: 1px solid var(--border);
  }

  .ext-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .ext-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ext-id {
    font-size: 11px;
    color: var(--muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ext-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.3;
  }

  .ext-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .ext-installed {
    font-size: 12px;
    color: var(--muted);
    padding: 0 6px;
  }

  .ext-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .ext-remove:hover:not(:disabled) {
    color: var(--danger, #e5484d);
    border-color: var(--danger, #e5484d);
  }

  .ext-remove:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ext-install-row {
    padding: 12px 0 0 0;
  }
</style>
