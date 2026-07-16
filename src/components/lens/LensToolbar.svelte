<script>
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { browserBookmarksStore } from '../../lib/stores/browser-bookmarks.svelte.js';
  import { lensHardRefresh } from '../../lib/api.js';
  import BrowserMenu from './browser/BrowserMenu.svelte';

  let {
    zoomLevel = 100,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onDownloads,
    onHistory,
    onBookmarks,
    onDownloadSettings,
    onDevtools,
    devtoolsActive = false,
  } = $props();

  let urlInput = $state('');

  $effect(() => {
    urlInput = browserTabsStore.activeTab?.inputUrl || lensStore.inputUrl;
  });

  onMount(() => {
    const unlisten = listen('lens-hard-refresh', () => {
      lensHardRefresh();
    });
    return () => { unlisten.then(fn => fn()); };
  });

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (trimmed) {
      lensStore.navigate(trimmed);
    }
  }

  // Real navigation state from WebView2 HistoryChanged (per-tab)
  const canGoBack = $derived(browserTabsStore.activeTab?.canGoBack === true);
  const canGoForward = $derived(browserTabsStore.activeTab?.canGoForward === true);

  // Bookmark star state for the current page
  const currentUrl = $derived(browserTabsStore.activeTab?.url || '');
  const isBookmarkable = $derived(!!currentUrl && currentUrl !== 'about:blank');
  const isBookmarked = $derived(browserBookmarksStore.has(currentUrl));

  // Feedback chip: the native child webview sits ABOVE the DOM below the
  // toolbar (airspace), so a Chrome-style popover would be hidden. Instead a
  // small confirmation chip appears INSIDE the address bar for a few seconds.
  let bookmarkFeedback = $state(null); // 'added' | 'removed' | null
  let feedbackTimer = null;

  async function handleBookmarkToggle() {
    if (!isBookmarkable) return;
    const added = await browserBookmarksStore.toggle(currentUrl, browserTabsStore.activeTab?.title || '');
    bookmarkFeedback = added ? 'added' : 'removed';
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { bookmarkFeedback = null; }, 3500);
  }

  function handleViewBookmarks() {
    bookmarkFeedback = null;
    clearTimeout(feedbackTimer);
    onBookmarks?.();
  }

  function handleBack() { lensStore.goBack(); }
  function handleForward() { lensStore.goForward(); }
  function handleReload(event) {
    if (event.shiftKey) {
      lensHardRefresh();
    } else {
      lensStore.reload();
    }
  }
</script>

<div class="lens-toolbar">
  <div class="toolbar-nav">
    <button class="nav-btn" onclick={handleBack} disabled={!canGoBack} title="Go back" aria-label="Go back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="nav-btn" onclick={handleForward} disabled={!canGoForward} title="Go forward" aria-label="Go forward">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <button class="nav-btn" onclick={handleReload} title="Reload (Shift+click for hard refresh)" aria-label="Reload page">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
    </button>
  </div>

  <form class="url-bar" onsubmit={handleSubmit}>
    <input
      class="url-input"
      type="text"
      bind:value={urlInput}
      placeholder="Enter URL or search..."
      spellcheck="false"
      autocomplete="off"
    />
    {#if bookmarkFeedback}
      <span class="bookmark-chip" role="status">
        {bookmarkFeedback === 'added' ? 'Bookmarked' : 'Bookmark removed'}
        {#if bookmarkFeedback === 'added'}
          <button type="button" class="bookmark-chip-link" onclick={handleViewBookmarks}>View all</button>
        {/if}
      </span>
    {/if}
    <button
      type="button"
      class="star-btn"
      class:starred={isBookmarked}
      onclick={handleBookmarkToggle}
      disabled={!isBookmarkable}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
      aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    </button>
  </form>

  <button
    class="nav-btn"
    class:active={lensStore.designMode}
    onclick={() => lensStore.setDesignMode(!lensStore.designMode)}
    title="Inspect Element"
    aria-label="Toggle element inspector"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2" stroke="currentColor" fill="none"/>
      <path d="M8 7l-1 10 3.5-3.5 3 5 1.5-.9-3-5H16L8 7z" fill="currentColor"/>
    </svg>
  </button>
  <button
    class="nav-btn"
    class:active={devtoolsActive}
    onclick={onDevtools}
    title="Toggle DevTools"
    aria-label="Toggle DevTools"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  </button>
  <BrowserMenu
    {zoomLevel}
    {onZoomIn}
    {onZoomOut}
    {onZoomReset}
    {onDownloads}
    {onHistory}
    {onBookmarks}
    {onDownloadSettings}
  />

</div>

<style>
  .lens-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: no-drag;
  }

  .toolbar-nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nav-btn {
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
    transition: background var(--duration-fast) var(--ease-out);
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg);
  }

  .nav-btn.active {
    background: var(--accent);
    color: var(--bg);
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .url-bar {
    flex: 1;
    display: flex;
    position: relative;
    align-items: center;
  }

  /* Bookmark star, inside the right edge of the address bar */
  .star-btn {
    position: absolute;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .star-btn:hover:not(:disabled) {
    color: var(--text);
  }

  .star-btn.starred {
    color: var(--warn);
  }

  .star-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* Confirmation chip inside the address bar (airspace-safe feedback) */
  .bookmark-chip {
    position: absolute;
    right: 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 22px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--text);
    font-size: 11px;
    white-space: nowrap;
    animation: bookmark-chip-in 0.2s var(--ease-out);
  }

  @keyframes bookmark-chip-in {
    from { opacity: 0; transform: translateX(6px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .bookmark-chip-link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
  }

  .bookmark-chip-link:hover {
    text-decoration: underline;
  }

  @media (prefers-reduced-motion: reduce) {
    .bookmark-chip {
      animation: none;
    }
  }

  .url-input {
    flex: 1;
    height: 28px;
    padding: 0 30px 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--muted);
  }


</style>
