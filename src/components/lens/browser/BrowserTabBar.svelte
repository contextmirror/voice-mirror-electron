<script>
  import { browserTabsStore } from '../../../lib/stores/browser-tabs.svelte.js';
  import { lensReload, lensHardRefresh, lensToggleTabMute } from '../../../lib/api.js';

  let { onNewTab, onNewPrivateTab } = $props();

  async function handleToggleMute(e, tabId) {
    e.stopPropagation();
    try {
      const res = await lensToggleTabMute(tabId);
      if (typeof res?.data?.muted === 'boolean') {
        browserTabsStore.setTabMuted(tabId, res.data.muted);
      }
    } catch (err) {
      console.warn('[BrowserTabBar] toggle mute failed:', err);
    }
  }

  let contextMenu = $state({ visible: false, x: 0, y: 0, tabId: null });

  // ── Drag-to-reorder ──
  let draggedTabId = $state(null);
  let dragOverTabId = $state(null);

  function handleDragStart(e, tabId) {
    draggedTabId = tabId;
    e.dataTransfer.effectAllowed = 'move';
    // Custom type so this never collides with the editor-tab / file-tree DnD.
    try { e.dataTransfer.setData('application/x-vm-browser-tab', tabId); } catch (_) {}
  }

  function handleDragOver(e, tabId) {
    if (!draggedTabId || draggedTabId === tabId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverTabId = tabId;
  }

  function handleDrop(e, tabId) {
    e.preventDefault();
    if (draggedTabId) browserTabsStore.reorderTab(draggedTabId, tabId);
    draggedTabId = null;
    dragOverTabId = null;
  }

  function handleDragEnd() {
    draggedTabId = null;
    dragOverTabId = null;
  }

  function handleClose(e, tabId) {
    e.stopPropagation();
    browserTabsStore.closeTab(tabId);
  }

  function handleContextMenu(e, tabId) {
    e.preventDefault();
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, tabId };
  }

  function closeContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, tabId: null };
  }

  function handleContextReload() {
    closeContextMenu();
    lensReload();
  }

  function handleContextHardRefresh() {
    closeContextMenu();
    lensHardRefresh();
  }

  function handleContextNewTab() {
    closeContextMenu();
    onNewTab?.();
  }

  function handleContextNewPrivateTab() {
    closeContextMenu();
    onNewPrivateTab?.();
  }

  function handleContextClose() {
    const id = contextMenu.tabId;
    closeContextMenu();
    if (!id) return;
    if (browserTabsStore.tabs.length > 1) {
      browserTabsStore.closeTab(id);
    } else {
      browserTabsStore.resetTab(id);
    }
  }

  function truncate(text, max = 24) {
    if (!text || text === 'New Tab') return 'New Tab';
    return text.length > max ? text.slice(0, max) + '\u2026' : text;
  }
</script>

<div class="browser-tab-bar" role="tablist">
  {#each browserTabsStore.tabs as tab (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="browser-tab"
      class:active={tab.id === browserTabsStore.activeTabId}
      class:loading={tab.loading}
      class:incognito={tab.incognito}
      class:drag-over={tab.id === dragOverTabId}
      class:dragging={tab.id === draggedTabId}
      draggable="true"
      ondragstart={(e) => handleDragStart(e, tab.id)}
      ondragover={(e) => handleDragOver(e, tab.id)}
      ondrop={(e) => handleDrop(e, tab.id)}
      ondragend={handleDragEnd}
      onclick={() => browserTabsStore.switchTab(tab.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') browserTabsStore.switchTab(tab.id); }}
      oncontextmenu={(e) => handleContextMenu(e, tab.id)}
      title={tab.url || tab.title}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === browserTabsStore.activeTabId}
    >
      <span class="browser-tab-icon" aria-hidden="true">
        {#if tab.loading}
          <span class="browser-tab-spinner"></span>
        {:else if tab.favicon}
          <img class="browser-tab-favicon" src={tab.favicon} alt="" />
        {:else}
          <svg class="browser-tab-globe" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        {/if}
      </span>
      {#if tab.incognito}
        <svg class="browser-tab-private" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Private tab">
          <path d="M2 12h20"/>
          <circle cx="6.5" cy="14.5" r="3"/>
          <circle cx="17.5" cy="14.5" r="3"/>
          <path d="M9.5 14.5c0-1 1-2 2.5-2s2.5 1 2.5 2"/>
          <path d="M4 12l2-5h12l2 5"/>
        </svg>
      {/if}
      <span class="browser-tab-title">{truncate(tab.title)}</span>
      {#if tab.audible || tab.muted}
        <button
          class="browser-tab-audio"
          class:muted={tab.muted}
          onclick={(e) => handleToggleMute(e, tab.id)}
          title={tab.muted ? 'Unmute tab' : 'Mute tab'}
          aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
        >
          {#if tab.muted}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          {/if}
        </button>
      {/if}
      {#if browserTabsStore.tabs.length > 1}
        <button
          class="browser-tab-close"
          onclick={(e) => handleClose(e, tab.id)}
          aria-label="Close tab"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>
  {/each}
  {#if browserTabsStore.canAddTab}
    <button
      class="browser-tab-add"
      onclick={() => onNewTab?.()}
      aria-label="New browser tab"
      title="New browser tab"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  {/if}
</div>

{#if contextMenu.visible}
  <div class="context-backdrop" role="button" tabindex="0" onclick={closeContextMenu} oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeContextMenu(); } }}></div>
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="context-menu-item" onclick={handleContextReload}>
      Reload
    </button>
    <button class="context-menu-item" onclick={handleContextHardRefresh}>
      Hard Refresh
    </button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item" onclick={handleContextNewTab}>
      New Tab
    </button>
    <button class="context-menu-item" onclick={handleContextNewPrivateTab}>
      New Private Tab
    </button>
    <button class="context-menu-item" onclick={handleContextClose}>
      Close Tab
    </button>
  </div>
{/if}

<style>
  @import '../../../styles/context-menu.css';

  /* ── Zed-style underline indicator ── */
  .browser-tab-bar {
    display: flex;
    align-items: center;
    height: 30px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 4px;
  }

  .browser-tab-bar::-webkit-scrollbar {
    display: none;
  }

  .browser-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 10px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 180px;
    position: relative;
    transition: color 0.15s ease;
  }

  /* Private (incognito) tab: subtle tint so it reads as a separate session. */
  .browser-tab.incognito {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .browser-tab-private {
    flex-shrink: 0;
    color: var(--accent);
    opacity: 0.85;
  }

  /* Accent underline indicator */
  .browser-tab::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 8px;
    right: 8px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: transparent;
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }

  .browser-tab:hover {
    color: var(--text);
  }

  .browser-tab.active {
    color: var(--text-strong);
  }

  /* Drag-to-reorder feedback */
  .browser-tab.dragging {
    opacity: 0.5;
  }

  .browser-tab.drag-over {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .browser-tab.active::after {
    background: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .browser-tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Favicon / globe / spinner slot — fixed so titles don't shift */
  .browser-tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }

  .browser-tab-favicon {
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }

  .browser-tab-globe {
    opacity: 0.55;
  }

  .browser-tab-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: var(--radius-full);
    animation: browser-tab-spin 0.8s linear infinite;
  }

  @keyframes browser-tab-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .browser-tab-spinner {
      animation: none;
      border-top-color: var(--border-strong);
    }
  }

  .browser-tab-audio {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .browser-tab-audio:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .browser-tab-audio.muted {
    color: var(--danger);
  }

  .browser-tab.active .browser-tab-audio {
    color: var(--text);
  }

  .browser-tab.active .browser-tab-audio.muted {
    color: var(--danger);
  }

  .browser-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s ease, background 0.1s ease;
  }

  .browser-tab:hover .browser-tab-close,
  .browser-tab.active .browser-tab-close {
    opacity: 1;
  }

  .browser-tab-close:hover {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }

  .browser-tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .browser-tab-add:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  /* ── Context menu ── */
  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }
</style>
