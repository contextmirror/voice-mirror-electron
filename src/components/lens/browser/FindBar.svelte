<script>
  import { onMount } from 'svelte';
  import { browserTabsStore } from '../../../lib/stores/browser-tabs.svelte.js';
  import { lensFindOnPage, lensFindNext, lensFindPrevious, lensCloseFind } from '../../../lib/api.js';

  let {
    visible = false,
    onClose = () => {},
  } = $props();

  let inputEl = $state(null);
  let query = $state('');
  let debounceTimer = $state(null);
  // Match counts: total on the page + which match we're currently on (1-based).
  let total = $state(0);
  let current = $state(0);

  // Auto-focus input when FindBar becomes visible
  $effect(() => {
    if (visible && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  // Clear selection + counts when FindBar closes
  $effect(() => {
    if (!visible) {
      total = 0;
      current = 0;
      const tabId = browserTabsStore.activeTabId;
      if (tabId) {
        lensCloseFind(tabId).catch(() => {});
      }
    }
  });

  async function doFind() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) { total = 0; current = 0; return; }
    try {
      const res = await lensFindOnPage(tabId, query);
      total = res?.data?.total ?? 0;
      current = res?.data?.found ? 1 : 0;
    } catch (err) {
      console.warn('[FindBar] find failed:', err);
    }
  }

  async function doNext() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) return;
    try {
      const res = await lensFindNext(tabId, query);
      total = res?.data?.total ?? total;
      if (res?.data?.found) {
        current = total > 0 ? (current >= total ? 1 : current + 1) : 1;
      } else {
        current = 0;
      }
    } catch (err) {
      console.warn('[FindBar] find next failed:', err);
    }
  }

  async function doPrevious() {
    const tabId = browserTabsStore.activeTabId;
    if (!tabId || !query.trim()) return;
    try {
      const res = await lensFindPrevious(tabId, query);
      total = res?.data?.total ?? total;
      if (res?.data?.found) {
        current = total > 0 ? (current <= 1 ? total : current - 1) : 1;
      } else {
        current = 0;
      }
    } catch (err) {
      console.warn('[FindBar] find previous failed:', err);
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doFind, 200);
  }

  const countLabel = $derived(
    total > 0 ? `${current}/${total}` : (query.trim() ? 'No results' : '')
  );

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        doPrevious();
      } else {
        doNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  }

  function handleClose() {
    query = '';
    onClose();
  }
</script>

{#if visible}
  <div class="find-bar" role="search" aria-label="Find on page">
    <input
      bind:this={inputEl}
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      type="text"
      class="find-input"
      placeholder="Find on page..."
      spellcheck="false"
      autocomplete="off"
      aria-label="Search query"
    />
    {#if countLabel}
      <span class="find-count" class:no-results={total === 0} role="status" aria-live="polite">{countLabel}</span>
    {/if}
    <div class="find-actions">
      <button
        class="find-btn"
        onclick={doPrevious}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
      <button
        class="find-btn"
        onclick={doNext}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button
        class="find-btn find-close"
        onclick={handleClose}
        title="Close (Escape)"
        aria-label="Close find bar"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .find-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .find-input {
    flex: 1;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-ui);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-out);
    min-width: 0;
  }

  .find-input:focus {
    border-color: var(--accent);
  }

  .find-input::placeholder {
    color: var(--muted);
  }

  .find-count {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    padding: 0 4px;
    white-space: nowrap;
  }

  .find-count.no-results {
    color: var(--danger);
  }

  .find-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .find-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
  }

  .find-btn:hover {
    background: var(--bg);
    color: var(--text);
  }

  .find-close {
    margin-left: 2px;
  }
</style>
