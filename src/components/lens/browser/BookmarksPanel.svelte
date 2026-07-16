<script>
  import { browserBookmarksStore } from '../../../lib/stores/browser-bookmarks.svelte.js';
  import { lensStore } from '../../../lib/stores/lens.svelte.js';

  let { onClose = () => {} } = $props();

  let searchQuery = $state('');

  let filtered = $derived(browserBookmarksStore.filter(searchQuery));

  function handleEntryClick(url) {
    lensStore.navigate(url);
    onClose();
  }

  async function handleRemove(e, url) {
    e.stopPropagation();
    await browserBookmarksStore.remove(url);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="bookmarks-panel"
  onkeydown={handleKeydown}
  role="region"
  aria-label="Bookmarks"
>
  <div class="bookmarks-header">
    <button class="back-btn" onclick={onClose} title="Close bookmarks" aria-label="Close bookmarks">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <span class="bookmarks-title">Bookmarks</span>
  </div>

  <div class="bookmarks-search">
    <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input
      class="search-input"
      type="text"
      bind:value={searchQuery}
      placeholder="Search bookmarks..."
      spellcheck="false"
      autocomplete="off"
    />
    {#if searchQuery}
      <button class="clear-search-btn" onclick={() => searchQuery = ''} title="Clear search" aria-label="Clear search">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    {/if}
  </div>

  <div class="bookmarks-list">
    {#if browserBookmarksStore.entries.length === 0}
      <div class="empty-state">No bookmarks yet — hit the star in the address bar.</div>
    {:else if searchQuery && filtered.length === 0}
      <div class="empty-state">No results for "{searchQuery}"</div>
    {:else}
      {#each filtered as entry (entry.url)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="bookmark-entry"
          role="button"
          tabindex="0"
          onclick={() => handleEntryClick(entry.url)}
          onkeydown={(e) => e.key === 'Enter' && handleEntryClick(entry.url)}
          title={entry.url}
        >
          <svg class="entry-star" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <div class="entry-content">
            <span class="entry-title">{entry.title || entry.url}</span>
            <span class="entry-url">{entry.url}</span>
          </div>
          <button
            class="delete-btn"
            onclick={(e) => handleRemove(e, entry.url)}
            title="Remove bookmark"
            aria-label="Remove bookmark"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .bookmarks-panel {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .bookmarks-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .back-btn:hover {
    background: var(--bg);
  }

  .bookmarks-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    flex: 1;
  }

  .bookmarks-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-icon {
    color: var(--muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-family);
    outline: none;
  }

  .clear-search-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .clear-search-btn:hover {
    color: var(--text);
  }

  .bookmarks-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    padding: 24px 12px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  .bookmark-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .bookmark-entry:hover {
    background: var(--bg-elevated);
  }

  .entry-star {
    color: var(--warn);
    flex-shrink: 0;
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .entry-title {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-url {
    font-size: 10.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .bookmark-entry:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--danger);
  }
</style>
