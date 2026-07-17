<script>
  /**
   * StatusBar.svelte -- VS Code/Zed-style status bar.
   *
   * 22px tall bar at the bottom of the app, showing git branch, diagnostics,
   * dev server status, LSP health (left side) and cursor position, indentation,
   * encoding, EOL, language, notification bell (right side).
   */
  import { listen } from '@tauri-apps/api/event';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { backOut, cubicIn, cubicOut } from 'svelte/easing';
  import { statusBarStore } from '../../lib/stores/status-bar.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { PROVIDER_ICONS } from '../../lib/providers.js';
  import { navigationStore } from '../../lib/stores/navigation.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { lspDiagnosticsStore } from '../../lib/stores/lsp-diagnostics.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import { updaterStore } from '../../lib/stores/updater.svelte.js';
  import { configStore, updateConfig } from '../../lib/stores/config.svelte.js';
  import { formatRelativeTime, unwrapResult } from '../../lib/utils.js';
  import { detectDevServers } from '../../lib/api.js';
  import ServersTab from '../lens/status/ServersTab.svelte';
  import UsagePulse from './UsagePulse.svelte';

  // -- Derived state --
  let hasProject = $derived(!!projectStore.root);
  let activeView = $derived(navigationStore.activeView);
  let showEditorInfo = $derived(statusBarStore.editorFocused && activeView === 'lens');

  // -- AI provider pill (moved here from the top titlebar) --
  let providerIcon = $derived(PROVIDER_ICONS[aiStatusStore.providerType || 'claude'] || null);

  // -- LSP install progress --
  /** @type {{ server: string, status: string, message: string } | null} */
  let lspInstall = $state(null);
  let installClearTimer = null;

  // -- Indentation dropdown --
  let indentDropdownOpen = $state(false);
  let indentGuides = $derived(configStore.value?.editor?.indentGuides !== false);

  function toggleIndentDropdown(e) {
    e.stopPropagation();
    indentDropdownOpen = !indentDropdownOpen;
  }

  function closeIndentDropdown() {
    indentDropdownOpen = false;
  }

  function toggleIndentGuides() {
    const next = !indentGuides;
    updateConfig({ editor: { indentGuides: next } });
  }

  function setIndentSpaces(size) {
    window.dispatchEvent(new CustomEvent('status-bar-indent-change', { detail: { type: 'spaces', size } }));
  }

  function setIndentTabs(size) {
    window.dispatchEvent(new CustomEvent('status-bar-indent-change', { detail: { type: 'tabs', size } }));
  }

  function convertTo(type) {
    window.dispatchEvent(new CustomEvent('status-bar-indent-convert', { detail: { to: type } }));
    closeIndentDropdown();
  }

  function detectIndent() {
    window.dispatchEvent(new CustomEvent('status-bar-indent-detect'));
    closeIndentDropdown();
  }

  // -- Dev server control popover (click the :PORT item to start/stop) --
  let devServerPanelOpen = $state(false);
  // A dev server DETECTED for the active project (may be stopped). Lets the bar show
  // a ▷ start affordance even when nothing is running yet — not just once it's up.
  let detectedServer = $state(null);

  // Re-detect whenever the active project changes.
  $effect(() => {
    const root = projectStore.root;
    if (!root) { detectedServer = null; return; }
    let cancelled = false;
    detectDevServers(root)
      .then((res) => {
        if (cancelled) return;
        const data = unwrapResult(res) || {};
        const list = data.servers || (Array.isArray(data) ? data : []);
        detectedServer = Array.isArray(list) && list.length > 0 ? list[0] : null;
      })
      .catch(() => { if (!cancelled) detectedServer = null; });
    return () => { cancelled = true; };
  });

  function toggleDevServerPanel(e) {
    e.stopPropagation();
    devServerPanelOpen = !devServerPanelOpen;
  }
  function closeDevServerPanel() {
    devServerPanelOpen = false;
  }
  // "Manage servers" → hand off to the full top-right Status dropdown.
  function openFullServerManager() {
    devServerPanelOpen = false;
    window.dispatchEvent(new CustomEvent('vm-open-server-manager'));
  }

  // -- Updater status item --
  // The status-bar update entry is a pure function of the updater store's
  // state machine. Click: available → download, ready/downloaded → restart.
  let updaterState = $derived(updaterStore.state);
  let showUpdaterItem = $derived(
    updaterState === 'checking' ||
    updaterState === 'available' ||
    updaterState === 'downloading' ||
    updaterState === 'downloaded' ||
    updaterState === 'ready'
  );

  function handleUpdaterClick() {
    const s = updaterStore.state;
    if (s === 'available') {
      updaterStore.downloadAndInstall();
    } else if (s === 'downloaded' || s === 'ready') {
      updaterStore.restartToApply();
    } else if (s === 'checking' || s === 'downloading') {
      // In-flight — no-op (let it finish).
    }
  }

  // -- Notification panel --
  // Open state lives in toastStore so the floating toast stack can suppress
  // itself while the panel is showing (the panel is THE surface then).
  const notifPanelOpen = $derived(toastStore.panelOpen);

  function toggleNotifPanel(e) {
    e.stopPropagation();
    toastStore.setPanelOpen(!toastStore.panelOpen);
  }

  function closeNotifPanel() {
    toastStore.setPanelOpen(false);
  }

  // Ring the bell when new unread notifications arrive — in center-first
  // mode there's no floating toast to catch the eye, so the bell itself
  // must announce arrivals.
  let bellRing = $state(false);
  let lastUnreadCount = 0;
  let bellRingTimer = null;
  $effect(() => {
    const count = toastStore.unreadCount;
    if (count > lastUnreadCount) {
      bellRing = false;
      requestAnimationFrame(() => { bellRing = true; });
      clearTimeout(bellRingTimer);
      bellRingTimer = setTimeout(() => { bellRing = false; }, 900);
    }
    lastUnreadCount = count;
    return () => clearTimeout(bellRingTimer);
  });

  /** Run a notification action and resolve the item (it's dealt with). */
  function runNotifAction(notif, act) {
    act.callback();
    toastStore.resolveItem(notif.id);
  }

  /** Merge single `action` and `actions` array into one pill row. */
  function notifActions(notif) {
    return notif.action ? [notif.action] : (Array.isArray(notif.actions) ? notif.actions : []);
  }

  function prefersReducedMotion() {
    return typeof matchMedia !== 'undefined'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** The panel grows out of the bell (bottom-right corner). */
  function panelIn(node, { duration = 260 } = {}) {
    if (prefersReducedMotion()) {
      return { duration: 120, easing: cubicOut, css: (t) => `opacity: ${t}` };
    }
    return {
      duration,
      easing: backOut,
      css: (t) => `
        transform-origin: bottom right;
        transform: translateY(${(1 - t) * 10}px) scale(${0.94 + t * 0.06});
        opacity: ${Math.min(1, t * 1.5)};
      `,
    };
  }

  /** ...and tucks back into it. */
  function panelOut(node, { duration = 150 } = {}) {
    if (prefersReducedMotion()) {
      return { duration: 100, easing: cubicIn, css: (t) => `opacity: ${t}` };
    }
    return {
      duration,
      easing: cubicIn,
      css: (t) => `
        transform-origin: bottom right;
        transform: translateY(${(1 - t) * 8}px) scale(${0.96 + t * 0.04});
        opacity: ${t};
      `,
    };
  }

  function handleDocumentClick() {
    if (notifPanelOpen) closeNotifPanel();
    if (indentDropdownOpen) closeIndentDropdown();
    if (devServerPanelOpen) closeDevServerPanel();
  }


  // -- Reactive sync: diagnostics --
  $effect(() => {
    // Track the diagnostics map to trigger re-sync
    lspDiagnosticsStore.diagnostics;
    statusBarStore.updateDiagnostics();
  });

  // -- Reactive sync: dev server --
  $effect(() => {
    // Track server state to trigger re-sync
    devServerManager.servers;
    const project = projectStore.activeProject;
    const serverState = project?.path ? devServerManager.getServerStatus(project.path) : null;
    statusBarStore.updateDevServer(serverState);
  });

  // -- Polling lifecycle --
  $effect(() => {
    if (hasProject) {
      statusBarStore.startPolling();
      return () => {
        statusBarStore.stopPolling();
      };
    } else {
      statusBarStore.stopPolling();
    }
  });

  // -- LSP install status listener --
  $effect(() => {
    let unlisten;
    listen('lsp-install-status', (event) => {
      const payload = event.payload;
      if (payload?.server && payload?.status && payload?.message) {
        // Clear any pending auto-clear timer
        if (installClearTimer) {
          clearTimeout(installClearTimer);
          installClearTimer = null;
        }

        if (payload.status === 'installing') {
          lspInstall = { server: payload.server, status: payload.status, message: payload.message };
          toastStore.addToast({ message: `Installing ${payload.server}...`, severity: 'info', key: `lsp-install-${payload.server}` });
        } else if (payload.status === 'installed') {
          lspInstall = { server: payload.server, status: payload.status, message: payload.message };
          toastStore.addToast({ message: `${payload.server} installed successfully`, severity: 'success', key: `lsp-install-${payload.server}` });
          // Auto-clear after 3 seconds
          installClearTimer = setTimeout(() => {
            lspInstall = null;
            installClearTimer = null;
          }, 3000);
        } else if (payload.status === 'install_failed') {
          lspInstall = { server: payload.server, status: payload.status, message: payload.message };
          toastStore.addToast({ message: payload.message || `Failed to install ${payload.server}`, severity: 'error', key: `lsp-install-${payload.server}` });
          // Auto-clear after 5 seconds
          installClearTimer = setTimeout(() => {
            lspInstall = null;
            installClearTimer = null;
          }, 5000);
        }
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      if (unlisten) unlisten();
      if (installClearTimer) {
        clearTimeout(installClearTimer);
        installClearTimer = null;
      }
    };
  });

  // -- Node.js not-found listener --
  $effect(() => {
    let unlisten;
    listen('lsp-node-not-found', () => {
      toastStore.addToast({
        message: 'Language server features require Node.js. Install from nodejs.org.',
        severity: 'error',
        duration: 0,
        key: 'lsp-node-not-found',
      });
    }).then(fn => { unlisten = fn; });

    return () => {
      if (unlisten) unlisten();
    };
  });
</script>

<svelte:document onclick={handleDocumentClick} />

<footer class="status-bar">
  <!-- ════════ LEFT SIDE ════════ -->
  <div class="status-bar-left">
    {#if hasProject}
      <!-- L1: Git branch -->
      {#if statusBarStore.gitBranch}
        <button class="sb-item" title="Git branch">
          <svg class="sb-icon git-branch" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6.5a1.5 1.5 0 0 1-1.5 1.5H9a2.5 2.5 0 0 0-2.5 2.5v.878a2.25 2.25 0 1 1-1.5 0V4.872a2.25 2.25 0 1 1 1.5 0V6.5A4 4 0 0 1 9 5h2a0 0 0 0 0 0 0V5.372a2.25 2.25 0 0 1-1.5-2.122zM5.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
          </svg>
          <span>{statusBarStore.gitBranch}{#if statusBarStore.gitDirty}*{/if}</span>
        </button>
      {/if}

      <!-- L2: Diagnostics -->
      <button class="sb-item" title="Errors and Warnings"
        onclick={() => window.dispatchEvent(new CustomEvent('status-bar-show-problems'))}>
        <span class="diag-errors" class:has-errors={statusBarStore.diagErrors > 0}>
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" stroke-width="1.5"/>
            <line x1="11" y1="5" x2="5" y2="11" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          {statusBarStore.diagErrors}
        </span>
        <span class="diag-warnings" class:has-warnings={statusBarStore.diagWarnings > 0}>
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12zM8 5v4M8 11v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          {statusBarStore.diagWarnings}
        </span>
      </button>

      <!-- L3: Dev server (click → start/stop/restart popover) -->
      {#if (statusBarStore.devServerStatus && statusBarStore.devServerStatus !== 'stopped') || detectedServer}
        <div class="dev-server-anchor">
          <button class="sb-item dev-server" title="Dev server — click to start / stop" onclick={toggleDevServerPanel} aria-expanded={devServerPanelOpen}>
            {#if statusBarStore.devServerStatus === 'running' || statusBarStore.devServerStatus === 'idle'}
              <span class="dev-icon dev-running">&#9654;</span>
              <span>:{statusBarStore.devServerPort}</span>
            {:else if statusBarStore.devServerStatus === 'starting'}
              <span class="dev-icon dev-starting">&#9654;</span>
              <span>starting...</span>
            {:else if statusBarStore.devServerStatus === 'crashed'}
              <span class="dev-icon dev-crashed">&#9632;</span>
              <span>crashed</span>
            {:else if detectedServer}
              <!-- Detected but not running → a start affordance -->
              <span class="dev-icon dev-stopped">&#9655;</span>
              <span>:{detectedServer.port}</span>
            {/if}
          </button>

          {#if devServerPanelOpen}
            <div class="dev-server-popover" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
              <div class="dev-server-popover-title">Dev servers</div>
              <ServersTab onManage={openFullServerManager} />
            </div>
          {/if}
        </div>
      {/if}

      <!-- L4: LSP health -->
      {#if statusBarStore.lspHealth !== 'none'}
        <button class="sb-item lsp-status" title="LSP Status: {statusBarStore.lspHealth}">
          <svg class="sb-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2l2 5-2 5M7 2l2 5-2 5M11 2l2 5-2 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span
            class="lsp-dot"
            class:lsp-healthy={statusBarStore.lspHealth === 'healthy'}
            class:lsp-starting={statusBarStore.lspHealth === 'starting'}
            class:lsp-error={statusBarStore.lspHealth === 'error'}
          ></span>
        </button>
      {/if}

      <!-- L5: LSP install progress -->
      {#if lspInstall}
        <button class="sb-item lsp-install-status" title={lspInstall.message}>
          {#if lspInstall.status === 'installing'}
            <svg class="sb-icon lsp-spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="6" stroke-opacity="0.25"/>
              <path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round"/>
            </svg>
            <span>Installing {lspInstall.server}...</span>
          {:else if lspInstall.status === 'installed'}
            <svg class="sb-icon lsp-installed-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3,8 7,12 13,4"/>
            </svg>
            <span>{lspInstall.server} ready</span>
          {:else if lspInstall.status === 'install_failed'}
            <svg class="sb-icon lsp-failed-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M7.56 1.44a.5.5 0 0 1 .88 0l6.5 12A.5.5 0 0 1 14.5 14h-13a.5.5 0 0 1-.44-.56l6.5-12z" fill="none"/>
              <line x1="8" y1="6" x2="8" y2="9"/>
              <circle cx="8" cy="11" r="0.5" fill="currentColor"/>
            </svg>
            <span>{lspInstall.server} failed</span>
          {/if}
        </button>
      {/if}
    {/if}
  </div>

  <!-- ════════ CENTER: AI provider pill (+ usage strip) ════════ -->
  <div class="status-bar-center">
    {#if aiStatusStore.providerType}
      <div class="sb-provider" aria-live="polite" title="AI provider status">
        <span class="sb-provider-icon-wrapper">
          {#if providerIcon?.type === 'cover'}
            <span class="sb-provider-icon" style="background: url({providerIcon.src}) center/cover no-repeat; border-radius: 3px;"></span>
          {:else if providerIcon}
            <span class="sb-provider-icon" style="background: {providerIcon.bg};">
              <img class="sb-provider-icon-img" src={providerIcon.src} alt="" />
            </span>
          {:else}
            <span class="sb-provider-icon placeholder"></span>
          {/if}
          <span class="sb-provider-dot" class:running={aiStatusStore.running} class:starting={aiStatusStore.starting}></span>
        </span>
        <span class="sb-provider-name">{aiStatusStore.displayName || 'AI Provider'}</span>
        <span class="sb-provider-state" class:running={aiStatusStore.running} class:starting={aiStatusStore.starting}>
          {aiStatusStore.running ? 'Running' : aiStatusStore.starting ? 'Starting…' : 'Stopped'}
        </span>
      </div>
    {/if}
    <UsagePulse />
  </div>

  <!-- ════════ RIGHT SIDE ════════ -->
  <div class="status-bar-right">
    <!-- R0: Update status (hidden when idle/disabled/error) -->
    {#if showUpdaterItem}
      <button
        class="sb-item updater-item"
        class:updater-ready={updaterState === 'ready' || updaterState === 'downloaded'}
        title="Software updates"
        onclick={handleUpdaterClick}
      >
        {#if updaterState === 'checking'}
          <svg class="sb-icon lsp-spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6" stroke-opacity="0.25"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round"/>
          </svg>
          <span>Checking for updates…</span>
        {:else if updaterState === 'available'}
          <svg class="sb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 10V2M5 6l3 3 3-3M3 13h10"/>
          </svg>
          <span>Update available</span>
        {:else if updaterState === 'downloading'}
          <svg class="sb-icon lsp-spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6" stroke-opacity="0.25"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round"/>
          </svg>
          <span>Downloading update… {updaterStore.progress}%</span>
        {:else}
          <!-- ready / downloaded -->
          <svg class="sb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3"/>
          </svg>
          <span>Update ready — restart</span>
        {/if}
      </button>
    {/if}

    {#if showEditorInfo}
      <!-- R1: Cursor position (click → Go to Line dialog) -->
      <button class="sb-item sb-clickable" title="Go to Line"
        onclick={() => window.dispatchEvent(new CustomEvent('status-bar-go-to-line'))}>
        <span>Ln {statusBarStore.cursor.line}, Col {statusBarStore.cursor.col}</span>
      </button>

      <!-- R2: Indentation (clickable dropdown) -->
      <div class="indent-anchor">
        <button class="sb-item sb-clickable" title="Indentation"
          onclick={toggleIndentDropdown}>
          <span>
            {#if statusBarStore.indent.type === 'tabs'}
              Tabs: {statusBarStore.indent.size}
            {:else}
              Spaces: {statusBarStore.indent.size}
            {/if}
          </span>
        </button>

        {#if indentDropdownOpen}
          <div class="indent-dropdown" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
            <div class="indent-section-label">Indent Using Spaces</div>
            <div class="indent-size-row">
              {#each [2, 4, 8] as size}
                <button class="indent-size-btn" role="menuitem"
                  class:active={statusBarStore.indent.type === 'spaces' && statusBarStore.indent.size === size}
                  onclick={() => setIndentSpaces(size)}>
                  {size}
                </button>
              {/each}
            </div>
            <div class="indent-section-label">Indent Using Tabs</div>
            <div class="indent-size-row">
              {#each [2, 4, 8] as size}
                <button class="indent-size-btn" role="menuitem"
                  class:active={statusBarStore.indent.type === 'tabs' && statusBarStore.indent.size === size}
                  onclick={() => setIndentTabs(size)}>
                  {size}
                </button>
              {/each}
            </div>
            <div class="indent-divider"></div>
            <button class="indent-item" role="menuitem" onclick={() => convertTo('spaces')}>
              Convert Indentation to Spaces
            </button>
            <button class="indent-item" role="menuitem" onclick={() => convertTo('tabs')}>
              Convert Indentation to Tabs
            </button>
            <button class="indent-item" role="menuitem" onclick={detectIndent}>
              Detect Indentation from Content
            </button>
            <div class="indent-divider"></div>
            <button class="indent-item" role="menuitem" onclick={toggleIndentGuides}>
              <span class="indent-check">{indentGuides ? '✓' : ''}</span>
              <span>Indent Guides</span>
            </button>
          </div>
        {/if}
      </div>

      <!-- R3: Encoding -->
      <button class="sb-item" title="Encoding">
        <span>{statusBarStore.encoding}</span>
      </button>

      <!-- R4: EOL -->
      <button class="sb-item" title="End of Line">
        <span>{statusBarStore.eol}</span>
      </button>

      <!-- R5: Language -->
      {#if statusBarStore.language}
        <button class="sb-item" title="Language Mode">
          <span>{statusBarStore.language}</span>
        </button>
      {/if}
    {/if}

    <!-- R6: Notification bell (always visible) -->
    <div class="bell-anchor">
      <button
        class="sb-item bell-btn"
        class:ring={bellRing}
        title="Notifications"
        onclick={toggleNotifPanel}
        aria-label="Notifications"
        aria-expanded={notifPanelOpen}
      >
        <svg class="sb-icon bell-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5c0 3.5-1.5 4.5-1.5 4.5h10s-1.5-1-1.5-4.5A3.5 3.5 0 0 0 8 1.5z"/>
          <path d="M6.5 12a1.5 1.5 0 0 0 3 0"/>
        </svg>
        {#if toastStore.unreadCount > 0}
          <span class="badge">{toastStore.unreadCount}</span>
        {/if}
      </button>

      <!-- Notification panel — the notification center, source of truth for
           every toast. Items keep their action buttons here, so a prompt
           missed as a toast is still actionable from history. -->
      {#if notifPanelOpen}
        <div
          class="notif-panel"
          role="menu"
          tabindex="-1"
          in:panelIn
          out:panelOut
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <div class="notif-header">
            <span class="notif-title">
              Notifications
              {#if toastStore.notifications.length > 0}
                <span class="notif-count">{toastStore.notifications.length}</span>
              {/if}
            </span>
            {#if toastStore.notifications.length > 0}
              <button class="notif-clear" onclick={() => toastStore.clearAll()}>
                Clear all
              </button>
            {/if}
          </div>
          <div class="notif-list">
            {#if toastStore.notifications.length === 0}
              <div class="notif-empty">You're all caught up.</div>
            {:else}
              {#each toastStore.notifications as notif (notif.id)}
                <div
                  class="notif-item {notif.severity || 'info'}"
                  class:unread={!notif.read}
                  animate:flip={{ duration: 200 }}
                  in:fade={{ duration: 150 }}
                >
                  <span class="notif-chip" aria-hidden="true">
                    {#if notif.severity === 'success'}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    {:else if notif.severity === 'warning'}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                    {:else if notif.severity === 'error'}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                      </svg>
                    {/if}
                  </span>
                  <div class="notif-content">
                    <div class="notif-top">
                      <span class="notif-message">{notif.message}</span>
                      <span class="notif-side">
                        {#if !notif.read}<span class="notif-dot" aria-label="Unread"></span>{/if}
                        <button
                          class="notif-dismiss"
                          onclick={() => toastStore.removeItem(notif.id)}
                          aria-label="Dismiss notification"
                          title="Dismiss"
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            <line x1="4" y1="4" x2="12" y2="12"/>
                            <line x1="12" y1="4" x2="4" y2="12"/>
                          </svg>
                        </button>
                      </span>
                    </div>
                    {#if notif.progress != null}
                      <div class="notif-progress-track">
                        <div class="notif-progress-bar" style="width: {Math.min(100, Math.max(0, notif.progress))}%"></div>
                      </div>
                    {/if}
                    {#if notifActions(notif).length > 0}
                      <div class="notif-actions">
                        {#each notifActions(notif) as act, i}
                          <button
                            class="notif-action"
                            class:primary={i === 0}
                            onclick={() => runNotifAction(notif, act)}
                          >
                            {act.label}
                          </button>
                        {/each}
                      </div>
                    {/if}
                    <span class="notif-time">{formatRelativeTime(notif.createdAt)}</span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</footer>

<style>
  /* ========== Status Bar Container ========== */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    min-height: 22px;
    flex-shrink: 0;
    padding: 0 4px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-family: var(--font-family);
    color: var(--muted);
    user-select: none;
    -webkit-app-region: no-drag;
    z-index: 100;
    position: relative;
  }

  /* ========== Left / Center / Right Sections ========== */
  /* Left & right flex:1 so the center section stays visually centred in the bar
     regardless of how wide the side content gets. */
  .status-bar-left,
  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 0;
    height: 100%;
    flex: 1 1 0;
    min-width: 0;
  }

  .status-bar-left {
    justify-content: flex-start;
  }

  .status-bar-right {
    justify-content: flex-end;
  }

  .status-bar-center {
    display: flex;
    align-items: center;
    height: 100%;
    flex: 0 1 auto;
    min-width: 0;
    justify-content: center;
    gap: 10px;
  }

  /* ========== Center: AI provider pill ========== */
  .sb-provider {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 6px;
    white-space: nowrap;
  }

  .sb-provider-icon-wrapper {
    position: relative;
    flex-shrink: 0;
    width: 15px;
    height: 15px;
  }

  .sb-provider-icon {
    width: 15px;
    height: 15px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .sb-provider-icon.placeholder {
    background: var(--bg-hover);
    border: 1px solid var(--border);
  }

  .sb-provider-icon-img {
    width: 65%;
    height: 65%;
    object-fit: contain;
  }

  .sb-provider-dot {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger, #ef4444);
    border: 1.5px solid var(--bg-elevated);
    transition: background var(--duration-fast, 100ms) var(--ease-out, ease);
  }

  .sb-provider-dot.running {
    background: var(--ok, #22c55e);
    box-shadow: 0 0 5px rgba(34, 197, 94, 0.5);
  }

  .sb-provider-dot.starting {
    background: var(--warn, #f59e0b);
    box-shadow: 0 0 5px rgba(245, 158, 11, 0.4);
    animation: sb-provider-pulse 1s ease-in-out infinite;
  }

  @keyframes sb-provider-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .sb-provider-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }

  .sb-provider-state {
    font-size: 12px;
    color: var(--muted);
  }

  .sb-provider-state.running {
    color: var(--ok, #22c55e);
  }

  .sb-provider-state.starting {
    color: var(--warn, #f59e0b);
  }

  @media (prefers-reduced-motion: reduce) {
    .sb-provider-dot {
      animation: none;
      transition: none;
    }
  }

  /* ========== Status Bar Items ========== */
  .sb-item {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 100%;
    padding: 0 5px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    transition: color var(--duration-fast, 100ms), background var(--duration-fast, 100ms);
    line-height: 1;
  }

  .sb-item:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .sb-clickable {
    cursor: pointer;
  }

  /* ========== Icons ========== */
  .sb-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  /* ========== L1: Git Branch ========== */
  .git-branch {
    width: 12px;
    height: 12px;
  }

  /* ========== L2: Diagnostics ========== */
  .diag-errors,
  .diag-warnings {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .diag-errors.has-errors {
    color: var(--danger);
  }

  .diag-warnings.has-warnings {
    color: var(--warn);
  }

  /* ========== L3: Dev Server ========== */
  .dev-icon {
    font-size: 10px;
    line-height: 1;
  }

  .dev-running {
    color: var(--ok);
  }

  .dev-starting {
    color: var(--warn);
  }

  .dev-crashed {
    color: var(--danger);
  }

  .dev-stopped {
    color: var(--muted);
  }

  .dev-server-anchor {
    position: relative;
    height: 100%;
  }

  /* Opens UPWARD (bottom bar) and aligned to the LEFT (the item is left-side). */
  .dev-server-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 4px;
    min-width: 280px;
    max-width: 360px;
    padding: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    border-radius: 6px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    animation: notif-in 0.12s ease-out;
  }

  .dev-server-popover-title {
    padding: 2px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }

  /* ========== L4: LSP Health ========== */
  .lsp-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
  }

  .lsp-dot.lsp-healthy {
    background: var(--ok);
  }

  .lsp-dot.lsp-starting {
    background: var(--warn);
  }

  .lsp-dot.lsp-error {
    background: var(--danger);
  }

  /* ========== L5: LSP Install Progress ========== */
  .lsp-install-status {
    gap: 4px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .lsp-spinner {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }

  .lsp-installed-icon {
    color: var(--ok);
  }

  .lsp-failed-icon {
    color: var(--danger);
  }

  /* ========== R0: Updater ========== */
  .updater-item {
    gap: 4px;
  }

  /* When an update is staged, draw attention with the accent colour. */
  .updater-item.updater-ready {
    color: var(--accent);
  }

  .updater-item.updater-ready:hover {
    color: var(--text);
  }

  /* ========== R2: Indentation dropdown ========== */
  .indent-anchor {
    position: relative;
    height: 100%;
  }

  .indent-dropdown {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: 6px;
    padding: 4px 0;
    min-width: 240px;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.4);
    z-index: 10000;
    animation: notif-in 0.12s ease-out;
  }

  .indent-section-label {
    padding: 4px 10px 2px;
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
  }

  .indent-size-row {
    display: flex;
    gap: 4px;
    padding: 2px 10px 4px;
  }

  .indent-size-btn {
    min-width: 32px;
    padding: 3px 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: background 100ms, border-color 100ms;
  }

  .indent-size-btn:hover {
    background: rgba(255,255,255,0.06);
  }

  .indent-size-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .indent-divider {
    height: 1px;
    margin: 4px 0;
    background: var(--border, rgba(255,255,255,0.08));
  }

  .indent-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
  }

  .indent-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .indent-check {
    width: 14px;
    text-align: center;
    font-size: 11px;
    color: var(--accent);
  }

  /* ========== R6: Bell ========== */
  .bell-anchor {
    position: relative;
    height: 100%;
  }

  .bell-btn {
    position: relative;
  }

  .bell-icon {
    width: 13px;
    height: 13px;
  }

  .badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    line-height: 14px;
    text-align: center;
    pointer-events: none;
  }

  /* Bell ring on new arrivals (center-first attention cue) */
  .bell-btn.ring .bell-icon {
    animation: bell-ring 0.8s var(--ease-out);
    color: var(--accent);
  }

  @keyframes bell-ring {
    0%, 100% { transform: rotate(0); }
    15% { transform: rotate(-16deg); }
    30% { transform: rotate(12deg); }
    45% { transform: rotate(-8deg); }
    60% { transform: rotate(5deg); }
    75% { transform: rotate(-2deg); }
  }

  /* ========== Notification Panel ========== */
  /* Same frosted-surface language as the toast capsules — the panel and the
     toasts are two states of one notification system. */
  .notif-panel {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: 380px;
    max-height: 440px;
    background: color-mix(in srgb, var(--bg-elevated) 86%, transparent);
    backdrop-filter: blur(14px) saturate(1.3);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 10002;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .notif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .notif-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .notif-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 15px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--accent);
    font-size: 10px;
    font-weight: 600;
  }

  .notif-clear {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  .notif-clear:hover {
    background: var(--bg-hover);
  }

  .notif-list {
    overflow-y: auto;
    flex: 1;
  }

  .notif-empty {
    padding: 28px 12px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    transition: background var(--duration-fast, 100ms);
  }

  .notif-item:last-child {
    border-bottom: none;
  }

  .notif-item:hover {
    background: var(--bg-hover);
  }

  .notif-item.unread {
    background: color-mix(in srgb, var(--accent-subtle) 30%, transparent);
  }

  /* Severity chip — same tinted-square language as the toast capsules */
  .notif-chip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .notif-chip svg {
    width: 13px;
    height: 13px;
  }

  .notif-item.info .notif-chip    { color: var(--accent); background: var(--accent-subtle); }
  .notif-item.success .notif-chip { color: var(--ok);     background: var(--ok-subtle); }
  .notif-item.warning .notif-chip { color: var(--warn);   background: var(--warn-subtle); }
  .notif-item.error .notif-chip   { color: var(--danger); background: var(--danger-subtle); }

  .notif-content {
    flex: 1;
    min-width: 0;
  }

  .notif-top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .notif-message {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text);
    word-break: break-word;
  }

  /* Unread dot sits where the dismiss button appears on hover */
  .notif-side {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    position: relative;
  }

  .notif-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .notif-item:hover .notif-dot {
    display: none;
  }

  .notif-time {
    display: block;
    margin-top: 6px;
    font-size: 10.5px;
    color: var(--muted);
  }

  /* Action pills — notifications stay actionable from history */
  .notif-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .notif-action {
    padding: 3px 12px;
    font-size: 11.5px;
    font-weight: 500;
    font-family: var(--font-family);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-out),
                border-color var(--duration-fast) var(--ease-out);
  }

  .notif-action:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .notif-action.primary {
    background: var(--accent);
    color: var(--accent-contrast, white);
    border-color: transparent;
  }

  .notif-action.primary:hover {
    background: var(--accent-hover);
  }

  .notif-progress-track {
    height: 3px;
    margin-top: 8px;
    background: var(--border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .notif-progress-bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease-out;
    border-radius: var(--radius-full);
  }

  .notif-dismiss {
    position: absolute;
    inset: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    opacity: 0;
    transition: opacity var(--duration-fast, 100ms);
  }

  .notif-item:hover .notif-dismiss {
    opacity: 1;
  }

  .notif-dismiss:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .notif-dismiss svg {
    width: 10px;
    height: 10px;
  }

  @media (prefers-reduced-motion: reduce) {
    .notif-item,
    .notif-action,
    .notif-dismiss,
    .notif-progress-bar {
      transition: none;
    }

    .bell-btn.ring .bell-icon {
      animation: none;
    }
  }
</style>
