<script>
  /**
   * Terminal.svelte -- xterm.js terminal for user shell PTY sessions.
   *
   * Each instance listens to scoped `terminal-output-{shellId}` events so it
   * only receives output for its own session. Used for user-created terminals
   * and dev-server tabs.
   */
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Unicode11Addon } from '@xterm/addon-unicode11';
  import '@xterm/xterm/css/xterm.css';
  import { listen } from '@tauri-apps/api/event';
  import { terminalInput, terminalResize } from '../../lib/api.js';
  import { currentThemeName } from '../../lib/stores/theme.svelte.js';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { searchBuffer, nextMatch, prevMatch } from '../../lib/terminal-search.js';
  import { createLinkOverlay } from '../../lib/terminal-link-overlay.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { basename, blendHex } from '../../lib/utils.js';
  import { open } from '@tauri-apps/plugin-shell';
  import TerminalSearch from './TerminalSearch.svelte';

  let { shellId, visible = true, onRegisterActions } = $props();

  let containerEl = $state(null);
  let term = $state(null);
  let fitAddon = $state(null);
  let webglAddon = $state(null);
  let resizeObserver = $state(null);
  let unlistenShellOutput = $state(null);
  let resizeTimeout = $state(null);
  let lastPtyCols = $state(0);
  let lastPtyRows = $state(0);
  let initialized = $state(false);
  let pendingEvents = [];
  let linkOverlay = null;

  // ---- Search state ----
  let searchVisible = $state(false);
  let searchQuery = $state('');
  let searchMatches = $state([]);
  let searchMatchCount = $state(0);
  let currentMatchIndex = $state(0);
  let searchCaseSensitive = $state(false);
  let searchRegex = $state(false);

  // ---- CSS token -> xterm.js theme mapping ----

  /**
   * Read a CSS custom property value from :root.
   * @param {string} prop - CSS variable name (e.g. '--bg')
   * @returns {string} The computed value, or empty string
   */
  function getCssVar(prop) {
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  }

  /**
   * Build an xterm.js ITheme object from current CSS custom properties.
   * Maps design tokens to xterm.js's ITheme keys.
   */
  function buildTermTheme() {
    const bg = getCssVar('--bg') || '#0c0d10';
    const bgElevated = getCssVar('--bg-elevated') || '#14161c';
    const text = getCssVar('--text') || '#e4e4e7';
    const textStrong = getCssVar('--text-strong') || '#fafafa';
    const muted = getCssVar('--muted') || '#71717a';
    const accent = getCssVar('--accent') || '#56b4e9';
    const ok = getCssVar('--ok') || '#0072b2';
    const warn = getCssVar('--warn') || '#e69f00';
    const danger = getCssVar('--danger') || '#d55e00';

    return {
      background: bg,
      foreground: text,
      cursor: accent,
      cursorAccent: bg,
      // Pre-blended opaque selection — an alpha color over a black background
      // is nearly invisible, and renderer alpha handling is unreliable.
      selectionBackground: blendHex(bg, accent, 0.35),
      selectionForeground: textStrong,
      // Standard ANSI colors mapped to theme tokens
      black: bg,
      red: danger,
      green: ok,
      yellow: warn,
      blue: accent,
      magenta: accent,   // Use accent as magenta stand-in
      cyan: ok,           // Use ok as cyan stand-in
      white: text,
      // Bright variants
      brightBlack: muted,
      brightRed: danger,
      brightGreen: ok,
      brightYellow: warn,
      brightBlue: accent,
      brightMagenta: accent,
      brightCyan: ok,
      brightWhite: textStrong,
    };
  }

  /**
   * Send resize to PTY only if cols/rows actually changed.
   * Prevents duplicate SIGWINCH signals.
   */
  function resizePtyIfChanged() {
    if (!term || !term.cols || !term.rows) return;
    if (term.cols === lastPtyCols && term.rows === lastPtyRows) return;
    lastPtyCols = term.cols;
    lastPtyRows = term.rows;
    terminalResize(shellId, term.cols, term.rows).catch((err) => {
      console.warn('[Terminal] PTY resize failed:', err);
    });
  }

  /**
   * Fit the terminal to its container.
   */
  function fitTerminal() {
    if (!fitAddon || !term) return;
    try {
      // Deliberately NOT the addon's fit(): that method calls
      // _renderService.clear() before resizing, blanking the canvas for a
      // frame — the visible flicker while resizing the window. Sizing via
      // proposeDimensions() + term.resize() repaints without the wipe
      // (what VS Code does).
      const dims = fitAddon.proposeDimensions();
      if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return;
      if (dims.cols !== term.cols || dims.rows !== term.rows) {
        term.resize(dims.cols, dims.rows);
      }
    } catch {
      // Not mounted yet or container has zero size
    }
  }

  // ---- Search functions ----

  /**
   * Extract visible text lines from the terminal buffer.
   * xterm.js exposes buffer via term.buffer.active.
   */
  function runSearch(query) {
    searchQuery = query;
    if (!term || !query) {
      searchMatches = [];
      searchMatchCount = 0;
      currentMatchIndex = 0;
      return;
    }

    const buffer = term.buffer?.active;
    if (!buffer) {
      searchMatches = [];
      searchMatchCount = 0;
      currentMatchIndex = 0;
      return;
    }

    const lineCount = buffer.length;
    const getLine = (y) => {
      const line = buffer.getLine(y);
      return line ? line.translateToString(true) : null;
    };

    const result = searchBuffer(getLine, lineCount, query, {
      caseSensitive: searchCaseSensitive,
      regex: searchRegex,
    });

    searchMatches = result.matches;
    searchMatchCount = result.total;
    currentMatchIndex = result.total > 0 ? 0 : 0;
  }

  function handleSearchNext() {
    if (searchMatchCount === 0) return;
    currentMatchIndex = nextMatch(searchMatchCount, currentMatchIndex);
    scrollToMatch(currentMatchIndex);
  }

  function handleSearchPrev() {
    if (searchMatchCount === 0) return;
    currentMatchIndex = prevMatch(searchMatchCount, currentMatchIndex);
    scrollToMatch(currentMatchIndex);
  }

  function scrollToMatch(index) {
    if (!term || !searchMatches[index]) return;
    const match = searchMatches[index];
    // Scroll the terminal to the match row if possible
    const buffer = term.buffer?.active;
    if (buffer) {
      const viewportTop = buffer.viewportY;
      const viewportBottom = viewportTop + term.rows;
      if (match.row < viewportTop || match.row >= viewportBottom) {
        // Scroll so match row is near the middle of the viewport
        const targetY = Math.max(0, match.row - Math.floor(term.rows / 2));
        term.scrollToLine(targetY);
      }
    }
  }

  function handleSearchClose() {
    searchVisible = false;
    searchQuery = '';
    searchMatches = [];
    searchMatchCount = 0;
    currentMatchIndex = 0;
    // Re-focus the terminal
    if (term) term.focus();
  }

  function handleToggleCase() {
    searchCaseSensitive = !searchCaseSensitive;
    if (searchQuery) runSearch(searchQuery);
  }

  function handleToggleRegex() {
    searchRegex = !searchRegex;
    if (searchQuery) runSearch(searchQuery);
  }

  // ---- Toolbar actions ----

  function handleClear() {
    if (!term) return;
    term.write('\x1b[2J\x1b[3J\x1b[H');
  }

  async function handleCopy() {
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
        term.clearSelection();
      } catch (err) {
        console.warn('[Terminal] Copy failed:', err);
      }
    }
  }

  async function handlePaste() {
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        // Route through xterm's paste pipeline (not terminalInput directly) so
        // bracketed-paste mode is honored — TUI apps rely on it to treat
        // multi-line pastes as one block instead of executing each line.
        term.paste(text);
      }
    } catch (err) {
      console.warn('[Terminal] Paste failed:', err);
    }
  }

  function handleSelectAll() {
    if (!term) return;
    term.selectAll();
  }

  // ---- Context menu state ----
  let ctxMenu = $state({ visible: false, x: 0, y: 0 });

  function handleTerminalContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    ctxMenu = { visible: true, x: event.clientX, y: event.clientY };
  }

  function closeCtxMenu() {
    ctxMenu = { ...ctxMenu, visible: false };
  }

  function ctxCopy() { closeCtxMenu(); handleCopy(); }
  function ctxPaste() { closeCtxMenu(); handlePaste(); }
  function ctxSelectAll() { closeCtxMenu(); handleSelectAll(); }
  function ctxClear() { closeCtxMenu(); handleClear(); }
  function ctxFind() { closeCtxMenu(); searchVisible = true; }
  function ctxSplitRight() { closeCtxMenu(); terminalTabsStore.splitInstance({ direction: 'horizontal' }); }
  function ctxSplitDown() { closeCtxMenu(); terminalTabsStore.splitInstance({ direction: 'vertical' }); }

  function handleDocumentClick() { if (ctxMenu.visible) closeCtxMenu(); }
  function handleDocumentKeydown(e) { if (e.key === 'Escape' && ctxMenu.visible) closeCtxMenu(); }

  // Register toolbar actions for parent TerminalTabs.
  // Wrapped in $effect so we capture the latest prop value (not just initial).
  $effect(() => {
    onRegisterActions?.({ clear: handleClear, copy: handleCopy, paste: handlePaste });
  });

  // ---- Shell output handler ----

  /**
   * Process a single terminal-output event payload.
   * Events are already scoped to this shellId via the event name, so no
   * filtering is needed here.
   * @param {{ id: string, event_type?: string, type?: string, text?: string, code?: number }} data
   */
  function handleShellOutput(data) {
    if (!term) return;

    switch (data.event_type || data.type) {
      case 'stdout':
        if (data.text) term.write(data.text);
        break;
      case 'exit':
        term.writeln('');
        term.writeln(`\x1b[33m[Shell exited with code ${data.code ?? '?'}]\x1b[0m`);
        terminalTabsStore.markExited(shellId);
        devServerManager.handleShellExit(shellId, data.code);
        break;
    }
  }

  // ---- Lifecycle: mount ----

  $effect(() => {
    if (!containerEl) return;

    let cancelled = false;

    async function setup() {
      if (cancelled) return;

      // Create xterm.js Terminal instance
      const xterm = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: getCssVar('--font-mono') || "'Cascadia Code', 'Fira Code', monospace",
        theme: buildTermTheme(),
        scrollback: 5000,
        convertEol: false,
        // Required by the Unicode 11 addon — `terminal.unicode` is a proposed
        // API in xterm 6 and loadAddon THROWS without this flag.
        allowProposedApi: true,
      });

      // Create FitAddon for auto-resize
      const fit = new FitAddon();
      xterm.loadAddon(fit);

      // Unicode 11 width tables — modern CLIs print emoji/symbols that the
      // default Unicode 6 widths mismeasure, causing redraw artifacts.
      // try/catch: a failure here must degrade to default widths, never kill
      // the whole terminal (an uncaught throw in setup() = blank panel).
      try {
        const unicode11 = new Unicode11Addon();
        xterm.loadAddon(unicode11);
        xterm.unicode.activeVersion = '11';
      } catch (err) {
        console.warn('[Terminal] Unicode 11 addon unavailable, using default widths:', err);
      }

      // Mount into DOM
      xterm.open(containerEl);

      if (cancelled) {
        xterm.dispose();
        return;
      }

      // Load the WebGL renderer for GPU-accelerated drawing (must load AFTER
      // open()). On context loss the addon is disposed and xterm.js falls back
      // to the DOM renderer instead of rendering a blank terminal.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          console.warn('[Terminal] WebGL context lost — falling back to DOM renderer');
          webgl.dispose();
          if (webglAddon === webgl) webglAddon = null;
        });
        xterm.loadAddon(webgl);
        webglAddon = webgl;
      } catch (err) {
        // WebGL unavailable (e.g. blocklisted GPU) — DOM renderer stays active.
        console.warn('[Terminal] WebGL renderer unavailable, using DOM renderer:', err);
      }

      // Store refs
      term = xterm;
      fitAddon = fit;

      // Keyboard input -> shell PTY
      xterm.onData((data) => {
        terminalInput(shellId, data).catch((err) => {
          console.warn('[Terminal] PTY input failed:', err);
        });
      });

      // Custom keyboard handler for Ctrl+C (copy), Ctrl+V (paste), Ctrl+F (search)
      // xterm.js convention: return true = "let the terminal process the key
      // normally"; return false = "stop, terminal should NOT process this key".
      xterm.attachCustomKeyEventHandler((event) => {
        // Only intercept keydown to avoid double-firing
        if (event.type !== 'keydown') return true;

        // Ctrl+F: toggle terminal search
        if (event.ctrlKey && event.key === 'f' && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          searchVisible = !searchVisible;
          if (!searchVisible) handleSearchClose();
          return false; // Prevent terminal default (browser find)
        }

        // Ctrl+C: copy selected text if there is a selection
        if (event.ctrlKey && event.key === 'c' && !event.shiftKey && !event.altKey) {
          if (xterm.hasSelection()) {
            event.preventDefault(); // Stop the native copy event (xterm also listens for it)
            handleCopy();
            return false; // Prevent terminal from sending \x03
          }
          return true; // Let terminal send interrupt (\x03)
        }

        // Ctrl+V: paste from clipboard.
        // preventDefault is load-bearing: returning false only skips xterm's
        // keydown processing — the browser's default paste still fires a native
        // `paste` event that xterm forwards to the PTY, so without it every
        // Ctrl+V pasted TWICE (handlePaste + native paste).
        if (event.ctrlKey && event.key === 'v' && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          handlePaste();
          return false; // Prevent terminal default
        }

        return true; // Let terminal process all other keys
      });

      // Listen for resize events from the terminal to send to PTY
      xterm.onResize(({ cols, rows }) => {
        if (cols === lastPtyCols && rows === lastPtyRows) return;
        lastPtyCols = cols;
        lastPtyRows = rows;
        terminalResize(shellId, cols, rows).catch((err) => {
          console.warn('[Terminal] PTY resize failed:', err);
        });
      });

      // Listen for shell output events scoped to this terminal session.
      // Each terminal emits to `terminal-output-{shellId}` so we only receive
      // events for our own session — no O(n) fan-out filtering needed.
      const unlisten = await listen(`terminal-output-${shellId}`, (event) => {
        if (!term) return;
        if (!initialized) {
          // Buffer events until terminal is fully initialized
          pendingEvents.push(event);
          return;
        }
        handleShellOutput(event.payload);
      });

      if (cancelled) {
        unlisten();
        xterm.dispose();
        return;
      }

      unlistenShellOutput = unlisten;

      // Observe container resize for auto-fitting.
      // Fit ONLY after the drag settles (debounced) — deliberately not live.
      // A live per-frame fit re-wraps the buffer to the new grid while the
      // running shell/TUI still paints for the OLD size (SIGWINCH is
      // debounced), showing garbled overlapping lines for the whole drag.
      // Mid-drag the canvas just crops/extends over the theme-colored
      // container instead.
      const observer = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          fitTerminal();
          resizePtyIfChanged();
          // Force a full canvas redraw on the next frame
          if (term) {
            requestAnimationFrame(() => {
              term.write('');
            });
          }
        }, 150);
      });
      observer.observe(containerEl);
      resizeObserver = observer;

      // Initial fit after layout settles (double rAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitTerminal();
          resizePtyIfChanged();
          // Gate: terminal is now fully initialized
          initialized = true;
          // Replay any events that arrived during initialization
          for (const evt of pendingEvents) {
            handleShellOutput(evt.payload);
          }
          pendingEvents = [];

          // Initialize clickable link overlay (Ctrl+click to open URLs/files)
          linkOverlay = createLinkOverlay({
            container: containerEl,
            getTerm: () => term,
            getCwd: () => projectStore.root || '',
            onOpenUrl: (url) => {
              open(url).catch(err => console.warn('[Terminal] Failed to open URL:', err));
            },
            onOpenFile: (match) => {
              const fileName = basename(match.path);
              if (match.line != null) {
                tabsStore.setPendingCursor(match.path, match.line - 1, (match.col || 1) - 1);
              }
              tabsStore.openFile({ name: fileName, path: match.path });
            },
          });
        });
      });
    }

    setup().catch((err) => {
      console.error('[Terminal] Init failed:', err);
    });

    // Cleanup on unmount
    return () => {
      cancelled = true;
      initialized = false;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (unlistenShellOutput) {
        unlistenShellOutput();
        unlistenShellOutput = null;
      }
      if (linkOverlay) {
        linkOverlay.destroy();
        linkOverlay = null;
      }
      if (term) {
        term.dispose(); // Also disposes loaded addons (fit, webgl)
        term = null;
      }
      fitAddon = null;
      webglAddon = null;
      lastPtyCols = 0;
      lastPtyRows = 0;
      pendingEvents = [];
    };
  });

  // ---- Re-fit when becoming visible ----

  $effect(() => {
    if (visible && fitAddon && term) {
      requestAnimationFrame(() => {
        fitTerminal();
        resizePtyIfChanged();
      });
    }
  });

  // ---- Theme reactivity ----

  $effect(() => {
    // Track theme name changes to trigger re-theming
    const _themeName = currentThemeName.value;

    if (!term) return;

    // Small delay to let CSS variables settle after theme application
    requestAnimationFrame(() => {
      term.options.theme = buildTermTheme();

      // Update font family in case it changed
      const fontMono = getCssVar('--font-mono');
      if (fontMono) {
        term.options.fontFamily = fontMono;
      }

      // Re-fit after theme/font change
      fitTerminal();
    });
  });
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="terminal-view" oncontextmenu={handleTerminalContextMenu}>
  <TerminalSearch
    visible={searchVisible}
    onClose={handleSearchClose}
    onSearch={runSearch}
    onNext={handleSearchNext}
    onPrev={handleSearchPrev}
    matchCount={searchMatchCount}
    currentMatch={currentMatchIndex}
    caseSensitive={searchCaseSensitive}
    regex={searchRegex}
    onToggleCase={handleToggleCase}
    onToggleRegex={handleToggleRegex}
  />
  <div class="terminal-container" class:ready={initialized} bind:this={containerEl}></div>

  {#if ctxMenu.visible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="terminal-ctx-backdrop" onclick={closeCtxMenu} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); closeCtxMenu(); } }} oncontextmenu={(e) => { e.preventDefault(); closeCtxMenu(); }}>
      <div class="terminal-ctx-menu" role="menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;">
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxCopy}>Copy<span class="terminal-ctx-shortcut">Ctrl+C</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxPaste}>Paste<span class="terminal-ctx-shortcut">Ctrl+V</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSelectAll}>Select All</button>
        <div class="terminal-ctx-separator"></div>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxClear}>Clear Terminal</button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxFind}>Find<span class="terminal-ctx-shortcut">Ctrl+F</span></button>
        <div class="terminal-ctx-separator"></div>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSplitRight}>Split Right<span class="terminal-ctx-shortcut">Ctrl+Shift+5</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSplitDown}>Split Down<span class="terminal-ctx-shortcut">Ctrl+Shift+&minus;</span></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    position: relative;
    /* Minimal left/right padding so terminal text doesn't touch the edge.
       No top padding — avoids visible gap between tab bar and terminal. */
    padding: 0 4px;
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
    contain: strict;
    border-top: none;
    visibility: hidden;
  }

  .terminal-container.ready {
    visibility: visible;
  }

  .terminal-container :global(canvas) {
    display: block;
  }

  .terminal-container :global(.xterm) {
    overflow: hidden !important;
  }

  /* Stock xterm.css hard-codes background #000 on .xterm and .xterm-viewport.
     Anything the canvas doesn't cover (scrollbar column, the sub-cell gap left
     by fit(), the exposed area mid-resize) paints PURE BLACK on non-black
     themes — seen as a black box while resizing + a thin black line after.
     Follow the app theme instead. */
  .terminal-container :global(.xterm),
  .terminal-container :global(.xterm-viewport) {
    background-color: var(--bg) !important;
  }

  /* ---- Context menu ---- */
  .terminal-ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }

  .terminal-ctx-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.06));
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .terminal-ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .terminal-ctx-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .terminal-ctx-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .terminal-ctx-separator {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.06));
    margin: 4px 0;
  }
</style>
