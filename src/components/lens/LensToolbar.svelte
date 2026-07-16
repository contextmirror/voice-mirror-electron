<script>
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { lensStore } from '../../lib/stores/lens.svelte.js';
  import { browserTabsStore } from '../../lib/stores/browser-tabs.svelte.js';
  import { browserBookmarksStore } from '../../lib/stores/browser-bookmarks.svelte.js';
  import { browserHistoryStore } from '../../lib/stores/browser-history.svelte.js';
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
    // Bindable: true while the omnibox suggestion dropdown is showing. The parent
    // (LensWorkspace) folds this into its freeze() effect — the native child
    // WebView2 sits ABOVE the DOM below the toolbar, so a dropdown over the page
    // area is invisible unless the webview is frozen (hidden) while it's open.
    suggestionsOpen = $bindable(false),
  } = $props();

  let urlInput = $state('');

  $effect(() => {
    urlInput = browserTabsStore.activeTab?.inputUrl || lensStore.inputUrl;
  });

  // ── Omnibox suggestions (history + bookmarks) ──
  let inputFocused = $state(false);
  let dismissed = $state(false);   // Escape closes the dropdown without blurring
  let selectedIndex = $state(-1);
  let inputEl = $state(null);

  const MAX_SUGGESTIONS = 8;

  // Bookmarks first (higher intent), then history; de-duplicated by URL and
  // excluding an exact match on what's already typed.
  const suggestions = $derived.by(() => {
    const q = urlInput.trim();
    if (!q) return [];
    const ql = q.toLowerCase();
    const bm = browserBookmarksStore.filter(q).map(e => ({ url: e.url, title: e.title, kind: 'bookmark' }));
    const hist = browserHistoryStore.filter(q).map(e => ({ url: e.url, title: e.title, kind: 'history' }));
    const seen = new Set();
    const out = [];
    for (const item of [...bm, ...hist]) {
      if (!item.url) continue;
      const key = item.url.toLowerCase();
      if (seen.has(key)) continue;
      if (key === ql) continue; // don't suggest exactly what's typed
      seen.add(key);
      out.push(item);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  });

  const showDropdown = $derived(inputFocused && !dismissed && suggestions.length > 0);

  // Publish open-state to the parent so the webview freezes while the dropdown
  // is up (airspace) and unfreezes the moment it closes.
  $effect(() => {
    suggestionsOpen = showDropdown;
  });

  // Keep the highlighted row valid as the list shrinks/grows.
  $effect(() => {
    if (selectedIndex >= suggestions.length) selectedIndex = suggestions.length - 1;
  });

  function navigateTo(target) {
    const trimmed = (target || '').trim();
    if (!trimmed) return;
    closeSuggestions();
    inputEl?.blur();
    lensStore.navigate(trimmed);
  }

  function closeSuggestions() {
    inputFocused = false;
    dismissed = false;
    selectedIndex = -1;
  }

  function handleInput() {
    dismissed = false;
    selectedIndex = -1;
  }

  function handleUrlKeydown(e) {
    if (!showDropdown) {
      // No dropdown — Escape restores the input to the current tab URL.
      if (e.key === 'Escape') {
        urlInput = browserTabsStore.activeTab?.inputUrl || lensStore.inputUrl;
        inputEl?.blur();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        navigateTo(suggestions[selectedIndex].url);
      }
      // else: fall through to the form submit (navigate to typed text)
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissed = true;
      selectedIndex = -1;
    }
  }

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
      closeSuggestions();
      inputEl?.blur();
      lensStore.navigate(trimmed);
    }
  }

  // Real navigation state from WebView2 HistoryChanged (per-tab)
  const canGoBack = $derived(browserTabsStore.activeTab?.canGoBack === true);
  const canGoForward = $derived(browserTabsStore.activeTab?.canGoForward === true);

  // ── Security indicator ──
  // Derived from the active tab URL (+ cert-error flag). 'secure' = padlock,
  // 'insecure' = warning (plain http), 'error' = TLS cert problem, null = none
  // (about:/file:/blank).
  const security = $derived.by(() => {
    if (browserTabsStore.activeTab?.certError) return 'error';
    const u = browserTabsStore.activeTab?.url || '';
    if (/^https:\/\//i.test(u)) return 'secure';
    if (/^http:\/\//i.test(u)) return 'insecure';
    return null;
  });
  const securityTitle = $derived(
    security === 'secure' ? 'Connection is secure (HTTPS)'
    : security === 'insecure' ? 'Not secure — this site uses plain HTTP'
    : security === 'error' ? 'Certificate error — connection is not private'
    : ''
  );

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
    {#if security}
      <span class="security-chip security-{security}" title={securityTitle} role="img" aria-label={securityTitle}>
        {#if security === 'secure'}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        {/if}
      </span>
    {/if}
    <input
      class="url-input"
      class:has-security={!!security}
      type="text"
      bind:this={inputEl}
      bind:value={urlInput}
      oninput={handleInput}
      onkeydown={handleUrlKeydown}
      onfocus={() => { inputFocused = true; dismissed = false; }}
      onblur={() => { inputFocused = false; }}
      placeholder="Enter URL or search..."
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      aria-expanded={showDropdown}
      aria-controls="omnibox-suggestions"
      aria-autocomplete="list"
    />
    {#if showDropdown}
      <ul class="omnibox-suggestions" id="omnibox-suggestions" role="listbox">
        {#each suggestions as sug, i (sug.url)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="omnibox-item"
            class:selected={i === selectedIndex}
            role="option"
            aria-selected={i === selectedIndex}
            onmousedown={(e) => { e.preventDefault(); navigateTo(sug.url); }}
            onmouseenter={() => { selectedIndex = i; }}
          >
            <span class="omnibox-item-icon" aria-hidden="true">
              {#if sug.kind === 'bookmark'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {/if}
            </span>
            <span class="omnibox-item-title">{sug.title || sug.url}</span>
            <span class="omnibox-item-url">{sug.url}</span>
          </li>
        {/each}
      </ul>
    {/if}
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

  /* Security indicator chip, inside the left edge of the address bar */
  .security-chip {
    position: absolute;
    left: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: auto;
    z-index: 1;
  }

  .security-chip.security-secure {
    color: var(--success, var(--accent));
  }

  .security-chip.security-insecure {
    color: var(--muted);
  }

  .security-chip.security-error {
    color: var(--danger);
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

  /* Make room for the security chip when present */
  .url-input.has-security {
    padding-left: 28px;
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--muted);
  }

  /* ── Omnibox suggestion dropdown ──
     Rendered over the page area (which the native webview covers), so it is
     only visible because the parent freezes the webview via `suggestionsOpen`. */
  .omnibox-suggestions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 100;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--shadow, #000) 30%, transparent);
    animation: omnibox-in 0.12s var(--ease-out);
  }

  @keyframes omnibox-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .omnibox-suggestions {
      animation: none;
    }
  }

  .omnibox-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
  }

  .omnibox-item.selected {
    background: var(--accent-subtle, color-mix(in srgb, var(--accent) 15%, transparent));
  }

  .omnibox-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--muted);
  }

  .omnibox-item.selected .omnibox-item-icon {
    color: var(--accent);
  }

  .omnibox-item-title {
    flex-shrink: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .omnibox-item-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

</style>
