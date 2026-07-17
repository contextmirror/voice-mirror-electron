<script>
  /**
   * BehaviorSettings.svelte -- General settings panel.
   *
   * User name, startup behavior, and advanced toggles
   * (debug mode, show dependencies).
   */
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toggle from '../shared/Toggle.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Button from '../shared/Button.svelte';
  import { onboardingStore } from '../../lib/stores/onboarding.svelte.js';
  import { updaterStore } from '../../lib/stores/updater.svelte.js';

  // ---- Local state ----

  let userName = $state('');
  let startMinimized = $state(false);
  let startWithSystem = $state(false);
  let autoStartProvider = $state(false);
  let autoVoiceLoop = $state(true);
  let floatingToasts = $state(false);
  let markdownPreview = $state(true);
  let debugMode = $state(false);
  let showDependencies = $state(false);

  // ---- Updates ----
  let autoCheckUpdates = $state(true);
  let appVersion = $state('');
  // Release channel is derived from the running build (see updater store);
  // it is read-only here because Tauri bakes the channel into the binary.
  let updateChannel = $derived(updaterStore.channel);
  let updateState = $derived(updaterStore.state);

  let saving = $state(false);

  // Load the running app version (guarded — throws outside a packaged Tauri app).
  $effect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) appVersion = v;
        // Derive the release channel from the running build (display-only).
        updaterStore.detectChannel();
      } catch {
        /* not in Tauri — leave blank */
      }
    })();
    return () => { cancelled = true; };
  });

  // ---- Sync from config store ----

  $effect(() => {
    const cfg = configStore.value;
    if (!cfg) return;

    userName = cfg.user?.name || '';
    startMinimized = cfg.behavior?.startMinimized === true;
    startWithSystem = cfg.behavior?.startWithSystem === true;
    autoStartProvider = cfg.ai?.autoStart === true;
    autoVoiceLoop = cfg.ai?.autoVoiceLoop !== false;
    floatingToasts = cfg.behavior?.floatingToasts === true;
    markdownPreview = cfg.editor?.markdownPreview !== false;
    debugMode = cfg.advanced?.debugMode === true;
    showDependencies = cfg.advanced?.showDependencies === true;
    autoCheckUpdates = cfg.updates?.autoCheck !== false;
  });

  // ---- Updates handlers ----

  function checkForUpdatesNow() {
    // Explicit check — surfaces errors (unlike silent background checks).
    updaterStore.checkForUpdates(true);
  }

  // ---- Save handler ----

  async function saveBehaviorSettings() {
    saving = true;
    try {
      const patch = {
        user: {
          name: userName || null,
        },
        behavior: {
          startMinimized,
          startWithSystem,
          floatingToasts,
        },
        ai: {
          autoStart: autoStartProvider,
          autoVoiceLoop,
        },
        editor: {
          markdownPreview,
        },
        advanced: {
          debugMode,
          showDependencies,
        },
        updates: {
          autoCheck: autoCheckUpdates,
        },
      };
      await updateConfig(patch);
      toastStore.addToast({ message: 'General settings saved', severity: 'success' });
    } catch (err) {
      console.error('[BehaviorSettings] Save failed:', err);
      toastStore.addToast({ message: 'Failed to save settings', severity: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="behavior-settings">
  <!-- User Name -->
  <section class="settings-section">
    <h3>User</h3>
    <div class="settings-group">
      <TextInput
        label="Name"
        value={userName}
        placeholder="Your name..."
        onChange={(v) => (userName = v.slice(0, 50))}
      />
    </div>
  </section>

  <!-- Startup Behavior -->
  <section class="settings-section">
    <h3>Startup</h3>
    <div class="settings-group">
      <Toggle
        label="Start Minimized"
        description="Launch with the panel hidden"
        checked={startMinimized}
        onChange={(v) => (startMinimized = v)}
      />
      <Toggle
        label="Start with System"
        description="Launch automatically on login"
        checked={startWithSystem}
        onChange={(v) => (startWithSystem = v)}
      />
      <Toggle
        label="Auto-Start AI Provider"
        description="Start the selected AI provider automatically on launch"
        checked={autoStartProvider}
        onChange={(v) => (autoStartProvider = v)}
      />
      <Toggle
        label="Auto Voice Loop"
        description="Inject the voice listen/send loop on provider startup. Disable to use the Voice button instead."
        checked={autoVoiceLoop}
        onChange={(v) => (autoVoiceLoop = v)}
      />
    </div>
  </section>

  <!-- Notifications -->
  <section class="settings-section">
    <h3>Notifications</h3>
    <div class="settings-group">
      <Toggle
        label="Floating toasts"
        description="Also pop notifications up over the workspace. When off, everything goes quietly to the notification bell in the status bar (errors still pop up)."
        checked={floatingToasts}
        onChange={(v) => (floatingToasts = v)}
      />
    </div>
  </section>

  <!-- Editor -->
  <section class="settings-section">
    <h3>Editor</h3>
    <div class="settings-group">
      <Toggle
        label="Markdown Preview"
        description="Show rendered preview by default when opening .md files"
        checked={markdownPreview}
        onChange={(v) => (markdownPreview = v)}
      />
    </div>
  </section>

  <!-- Advanced -->
  <section class="settings-section">
    <h3>Advanced</h3>
    <div class="settings-group">
      <Toggle
        label="Debug Mode"
        description="Capture DEBUG and TRACE level logs in the Output panel"
        checked={debugMode}
        onChange={(v) => (debugMode = v)}
      />
      <Toggle
        label="Show Dependencies"
        description="Show Dependencies tab in settings"
        checked={showDependencies}
        onChange={(v) => (showDependencies = v)}
      />
    </div>
  </section>

  <!-- Updates -->
  <section class="settings-section">
    <h3>Updates</h3>
    <div class="settings-group">
      <div class="update-version-row">
        <span class="update-version-label">Current version</span>
        <span class="update-version-value">{appVersion || '—'}</span>
      </div>

      <Toggle
        label="Automatically Check for Updates"
        description="Check for new versions in the background (30s after launch, then every 6 hours)"
        checked={autoCheckUpdates}
        onChange={(v) => (autoCheckUpdates = v)}
      />

      <!-- Channel indicator (read-only — the channel is set by which build you installed) -->
      <div class="update-channel-setting">
        <div class="update-channel-text">
          <span class="update-channel-label">Update Channel</span>
          <span class="update-channel-desc">
            Determined by the build you installed. Nightly gets newer, less-tested builds —
            switch by installing the other build.
          </span>
        </div>
        <span
          class="channel-indicator"
          class:nightly={updateChannel === 'nightly'}
          aria-label="Current update channel"
        >{updateChannel === 'nightly' ? 'Nightly' : 'Stable'}</span>
      </div>

      <!-- Check now -->
      <div class="update-check-row">
        <span class="update-status-text">
          {#if updateState === 'checking'}Checking…
          {:else if updateState === 'available'}Update available ({updaterStore.version})
          {:else if updateState === 'downloading'}Downloading… {updaterStore.progress}%
          {:else if updateState === 'ready' || updateState === 'downloaded'}Update ready — restart to apply
          {:else if updateState === 'error'}Update check failed
          {:else if updateState === 'disabled'}Updates unavailable in this build
          {:else}You're up to date{/if}
        </span>
        <Button small onClick={checkForUpdatesNow} disabled={updaterStore.isBusy}>
          Check for updates
        </Button>
      </div>
    </div>
  </section>

  <!-- Setup -->
  <section class="settings-section">
    <h3>Setup</h3>
    <p class="setup-hint">
      Re-run the first-run welcome wizard to detect, install, sign into, or switch
      AI providers.
    </p>
    <div class="settings-group">
      <div class="setup-actions">
        <Button small onClick={() => onboardingStore.open()}>Run welcome setup again</Button>
      </div>
    </div>
  </section>

  <!-- Save Button -->
  <div class="settings-actions">
    <Button variant="primary" onClick={saveBehaviorSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save General Settings'}
    </Button>
  </div>
</div>

<style>
  .behavior-settings {
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

  .settings-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }

  .setup-hint {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 10px 0;
    line-height: 1.5;
  }

  .setup-actions {
    padding: 8px;
  }

  /* ---- Updates ---- */
  .update-version-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
  }

  .update-version-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .update-version-value {
    font-size: 13px;
    color: var(--muted);
    font-family: var(--font-mono);
  }

  .update-channel-setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .update-channel-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .update-channel-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .update-channel-desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.3;
  }

  .channel-indicator {
    flex-shrink: 0;
    padding: 4px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .channel-indicator.nightly {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .update-check-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    gap: 16px;
  }

  .update-status-text {
    font-size: 13px;
    color: var(--muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
