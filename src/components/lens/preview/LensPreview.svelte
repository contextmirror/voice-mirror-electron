<script>
  import { onMount, onDestroy } from 'svelte';
  import { lensStore, DEFAULT_URL } from '../../../lib/stores/lens.svelte.js';
  import { projectStore } from '../../../lib/stores/project.svelte.js';
  import { devServerManager } from '../../../lib/stores/dev-server-manager.svelte.js';
  import { toastStore } from '../../../lib/stores/toast.svelte.js';
  import { browserTabsStore } from '../../../lib/stores/browser-tabs.svelte.js';
  import { lensResizeWebview, lensCloseAllTabs, lensClearCache, detectDevServers, designCommand } from '../../../lib/api.js';
  import { listen } from '@tauri-apps/api/event';
  import { unwrapResult } from '../../../lib/utils.js';

  let containerEl = $state(null);
  let resizeObserver = null;
  let rafId = null;
  let unlistenUrl = null;
  let unlistenOpenTab = null;
  let unlistenTitle = null;
  let unlistenFocusTab = null;
  let unlistenNewWindow = null;
  let unlistenFavicon = null;
  let unlistenHistoryState = null;
  let unlistenCertError = null;
  let unlistenAudioState = null;
  let unlistenFullscreen = null;
  let unlistenLoading = null;
  let setupDone = false;
  const LOADING_TIMEOUT_MS = 15000;
  let loadingTimer = null;
  let detectionTimer = null;
  let creatingFirstTab = false;
  // True while a page is in HTML5 fullscreen — the active webview then fills the
  // whole window (bounds sync must not clamp it back to the browser pane).
  let isFullscreen = false;

  function getAbsoluteBounds() {
    if (!containerEl) return null;
    const rect = containerEl.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  export function createNewTab(url = 'about:blank', opts = {}) {
    const bounds = getAbsoluteBounds();
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      // Re-clamp the newly-active webview to the current browser-pane rect so a
      // tab created mid-layout can never keep bounds that span the bottom panel.
      browserTabsStore.openTab(url, bounds, opts).then(() => syncBounds());
    }
  }

  function syncBounds() {
    const bounds = getAbsoluteBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      // Container is CSS-hidden (display:none — e.g. a file tab is active, not
      // the browser). A native child WebView2 does NOT respect CSS display:none,
      // so if a webview exists it would stay visible as a grey rectangle over
      // the UI. Move it off-screen instead of bailing.
      if (lensStore.webviewReady) {
        lensResizeWebview(-9999, -9999, 0, 0).catch(() => {});
      }
      return;
    }
    // Container is visible and a page is in HTML5 fullscreen → fill the whole
    // window regardless of the pane rect (re-applied on any mid-fullscreen
    // resize). This branch is BELOW the hidden-container guard on purpose: a
    // fullscreen video hidden behind a file tab is parked, not blown up.
    if (isFullscreen && lensStore.webviewReady) {
      lensResizeWebview(0, 0, window.innerWidth, window.innerHeight).catch(() => {});
      return;
    }
    lensResizeWebview(bounds.x, bounds.y, bounds.width, bounds.height).catch(() => {});
  }

  /** Safety net: clear loading state after timeout so user is never stuck. */
  function startLoadingTimeout() {
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      if (lensStore.loading) {
        console.warn('[LensPreview] Loading timeout — clearing stuck loading state');
        lensStore.setLoading(false);
      }
    }, LOADING_TIMEOUT_MS);
  }

  /** Watch loading state to arm/disarm the safety timeout. */
  $effect(() => {
    if (lensStore.loading) {
      startLoadingTimeout();
    } else {
      clearTimeout(loadingTimer);
    }
  });

  /** Sync lensStore URL/inputUrl when the active browser tab changes (tab switch or close). */
  $effect(() => {
    const active = browserTabsStore.activeTab;
    if (active?.url) {
      lensStore.setUrl(active.url);
      lensStore.setInputUrl(active.url);
    }
  });

  // ---- Project switch → dev server detection + browser navigation ----
  // Plain variables (NOT $state) — used only as guards inside effects.
  // Using $state would re-trigger the effects when written, causing either
  // an infinite loop or cancelled timeouts.
  let lastDetectedProject = null;
  let previousProjectIndex = null;

  // Trigger detection + navigation when active project changes.
  //
  // IMPORTANT: The detection timer is managed OUTSIDE the effect cleanup.
  // Svelte 5 calls the effect cleanup on every re-trigger (including benign
  // ones from file watcher, config updates, etc.). If we used `return () =>
  // clearTimeout(timer)`, the cleanup would cancel the pending detection on
  // re-trigger, and the guard would prevent re-scheduling — so detection
  // would never run. Instead, we manage `detectionTimer` as a component-level
  // variable and only cancel it when a REAL project switch happens.
  $effect(() => {
    const project = projectStore.activeProject;
    const currentIndex = projectStore.activeIndex;
    if (!project) {
      // Reset detection guard so re-adding the same project triggers detection again
      lastDetectedProject = null;
      previousProjectIndex = currentIndex;
      return;
    }

    // Capture values for deferred work (avoid reading reactive state in timeout)
    const oldIndex = previousProjectIndex;
    const oldPath = lastDetectedProject;

    // Set guard SYNCHRONOUSLY so re-triggers see it immediately
    lastDetectedProject = project.path;
    previousProjectIndex = currentIndex;

    // Same project, same index → no change (prevents re-trigger on unrelated store updates)
    if (project.path === oldPath && currentIndex === oldIndex) return;

    // Cancel any previous pending detection (real project switch)
    clearTimeout(detectionTimer);
    detectionTimer = setTimeout(() => {
      detectionTimer = null;

      // Save current URL for the outgoing project (deferred to avoid entries mutation loop)
      if (oldIndex !== null && oldIndex !== currentIndex && lensStore.webviewReady) {
        const currentUrl = lensStore.url;
        if (currentUrl && currentUrl !== DEFAULT_URL) {
          projectStore.updateProjectField(oldIndex, 'lastBrowserUrl', currentUrl);
        }
      }

      // Retire the outgoing project's consent prompt — it's contextual to
      // the visible workspace, and leaving it up means every Tauri project
      // the user visits accumulates its own sticky "Start it?" toast.
      if (oldPath && oldPath !== project.path) {
        toastStore.dismissByKey('dev-server-consent-' + oldPath);
      }

      devServerManager.handleProjectSwitch(oldPath, project.path);
      detectAndNavigate(project);
    }, 300);
  });

  // Also trigger detection when webview becomes ready (catches initial load race)
  $effect(() => {
    if (!lensStore.webviewReady) return;
    const project = projectStore.activeProject;
    if (project && project.path !== lastDetectedProject) {
      lastDetectedProject = project.path;
      previousProjectIndex = projectStore.activeIndex;
      detectAndNavigate(project);
    }
  });

  // "Not now" on the dev-server consent prompt persists a 24h snooze on the
  // project entry (consentSnoozedUntil) — it survives app restarts, so the
  // prompt doesn't greet the user on every dev-cycle relaunch, but expires
  // on its own (no permanent opt-out trap; there is no re-enable UI yet).
  // Any start action clears it. ✕ on the toast is handled separately by the
  // toast store (session-scoped: user-dismissed keys never re-float).
  const CONSENT_SNOOZE_MS = 24 * 60 * 60 * 1000;

  function snoozeConsent(projectPath) {
    const idx = projectStore.entries.findIndex((e) => e.path === projectPath);
    if (idx !== -1) {
      projectStore.updateProjectField(idx, 'consentSnoozedUntil', Date.now() + CONSENT_SNOOZE_MS);
    }
  }

  function clearConsentSnooze(projectPath) {
    const idx = projectStore.entries.findIndex((e) => e.path === projectPath);
    if (idx !== -1 && projectStore.entries[idx].consentSnoozedUntil) {
      projectStore.updateProjectField(idx, 'consentSnoozedUntil', null);
    }
  }

  // Guards against parked async runs: detectAndNavigate awaits webview
  // readiness (up to 10s), so a project switch mid-wait left the OLD call
  // to resume later and prompt for the wrong project. Each call takes a
  // generation; stale generations bail after every await.
  let detectionGeneration = 0;

  async function detectAndNavigate(project) {
    const generation = ++detectionGeneration;
    // Wait for the webview to be ready (may still be creating during first project load)
    if (!lensStore.webviewReady) {
      // Poll for readiness up to 10 seconds (webview creation can take a few seconds)
      const ready = await new Promise(resolve => {
        if (lensStore.webviewReady) return resolve(true);
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 200;
          if (lensStore.webviewReady) { clearInterval(interval); resolve(true); }
          else if (elapsed >= 10000) { clearInterval(interval); resolve(false); }
        }, 200);
      });
      if (!ready) {
        console.warn('[lens] Webview not ready after 10s, skipping detection');
        return;
      }
      // Superseded while waiting → a newer call owns detection now.
      if (generation !== detectionGeneration) return;
    }

    lensStore.setDevServerLoading(true);

    try {
      const result = await detectDevServers(project.path);
      if (generation !== detectionGeneration) return;
      /** @type {{ servers?: unknown[], packageManager?: string }} */
      const data = unwrapResult(result) || {};
      const servers = data.servers || [];
      const packageManager = data.packageManager || null;
      lensStore.setDevServers(servers);

      // Determine URL to navigate to (priority: preferred > running server > last URL)
      let targetUrl = null;

      if (project.preferredServerUrl) {
        targetUrl = project.preferredServerUrl;
      } else {
        const running = servers.find(s => s.running);
        if (running) {
          targetUrl = running.url;
        } else if (project.lastBrowserUrl) {
          targetUrl = project.lastBrowserUrl;
        }
      }

      // Only auto-navigate a BLANK active tab. A restored browser session
      // (or any page the user already has up) must not be clobbered by
      // preferred/last-URL navigation on startup or project switch.
      const activeTabUrl = browserTabsStore.activeTab?.url;
      const activeIsBlank = !activeTabUrl || activeTabUrl === 'about:blank';
      if (targetUrl && activeIsBlank) {
        // Clear WebView2 disk cache before navigating to prevent stale content
        // from a previously-cached localhost port (e.g. switching from solitaire
        // on :3000 to Next.js on :3000 would show solitaire without this).
        await lensClearCache().catch(() => {});
        lensStore.navigate(targetUrl);
      }

      // Auto-start logic for stopped servers
      const stoppedServer = servers.find(s => !s.running);
      if (stoppedServer) {
        // Skip the offer if the dev server manager already has this server as running/starting
        // (can happen when detection re-fires while a server is mid-start)
        // Monorepo workspace members carry their own spawn dir (`cwd`).
        const launchPath = stoppedServer.cwd || project.path;
        const existingState = devServerManager.getServerStatus(launchPath);
        if (existingState && (existingState.status === 'running' || existingState.status === 'starting')) {
          console.log('[lens] Server already running/starting, skipping offer');
        } else {
          const autoStart = project.autoStartServer;
          console.log('[lens] Auto-start check:', { autoStart, framework: stoppedServer.framework, port: stoppedServer.port });
          if (project.consentSnoozedUntil && project.consentSnoozedUntil > Date.now()) {
            // "Not now" answered recently (persisted snooze) — don't re-offer.
            console.log('[lens] Consent snoozed, skipping offer');
          } else if (autoStart === null || autoStart === undefined) {
            if (stoppedServer.needsSetup) {
              // Missing venv or deps — offer to set up environment
              toastStore.addToast({
                message: `${stoppedServer.framework || 'Python'} detected but needs environment setup. Set up & start?`,
                severity: 'warning',
                key: 'dev-server-consent-' + project.path,
                duration: 0,
                actions: [
                  {
                    label: 'Set up & start',
                    callback: () => {
                      clearConsentSnooze(project.path);
                      devServerManager.startServer(stoppedServer, launchPath, packageManager);
                    },
                  },
                  {
                    label: 'Not now',
                    callback: () => snoozeConsent(project.path),
                  },
                ],
              });
            } else {
              // Normal flow — venv exists or not a Python project
              toastStore.addToast({
                message: `${stoppedServer.framework || 'Dev server'} on :${stoppedServer.port} is not running. Start it?`,
                severity: 'warning',
                key: 'dev-server-consent-' + project.path,
                duration: 0,
                actions: [
                  {
                    label: 'Always start',
                    callback: () => {
                      clearConsentSnooze(project.path);
                      projectStore.updateActiveField('autoStartServer', true);
                      devServerManager.startServer(stoppedServer, launchPath, packageManager);
                    },
                  },
                  {
                    label: 'Start once',
                    callback: () => {
                      clearConsentSnooze(project.path);
                      devServerManager.startServer(stoppedServer, launchPath, packageManager);
                    },
                  },
                  {
                    label: 'Not now',
                    callback: () => snoozeConsent(project.path),
                  },
                ],
              });
            }
          } else if (autoStart === true) {
            // User opted in — auto-start silently
            devServerManager.startServer(stoppedServer, launchPath, packageManager);
          }
          // autoStart === false → do nothing
        }
      }
    } catch (err) {
      console.error('[lens] Dev server detection failed:', err);
    } finally {
      lensStore.setDevServerLoading(false);
    }
  }

  // Hide/show webview when lensStore.hidden changes (e.g. screenshot picker overlay)
  $effect(() => {
    if (!lensStore.webviewReady) return;
    if (lensStore.hidden) {
      // Move webview off-screen so DOM overlays can render above it
      lensResizeWebview(-9999, -9999, 0, 0).catch(() => {});
    } else {
      // Restore correct bounds
      syncBounds();
    }
  });


  // Enable/disable the design canvas overlay when design mode changes
  $effect(() => {
    const isDesignMode = lensStore.designMode;
    if (!lensStore.webviewReady) return;
    if (isDesignMode) {
      designCommand('enable', {}).catch((err) => {
        console.warn('[LensPreview] Design enable failed:', err);
      });
    } else {
      designCommand('disable', {}).catch((err) => {
        console.warn('[LensPreview] Design disable failed:', err);
      });
    }
  });

  async function createFirstTab() {
    if (!containerEl) return;
    if (lensStore.webviewReady) return; // Already created
    if (creatingFirstTab) return;       // Already in-flight (prevents ResizeObserver + onMount race)
    creatingFirstTab = true;

    // Wait for layout to settle before measuring bounds (double rAF)
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    const bounds = getAbsoluteBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      // Container is CSS-hidden (display:none when file tab is active).
      // Don't waste retries — we'll try again when the container becomes visible
      // via the ResizeObserver set up in onMount.
      console.log('[LensPreview] Container has zero bounds, will create tab when visible');
      creatingFirstTab = false; // Reset so ResizeObserver can retry when container becomes visible
      return;
    }

    // A saved browser session (from workspace-state) takes precedence over
    // the default blank tab — restarting the app no longer loses your tabs.
    const session = browserTabsStore.takePendingRestore();
    if (session) {
      console.log('[LensPreview] Restoring browser session:', session.tabs.length, 'tab(s)');
      try {
        const ids = [];
        for (const saved of session.tabs) {
          const id = await browserTabsStore.openTab(saved.url, bounds);
          if (id) {
            ids.push(id);
            if (saved.title) browserTabsStore.setTabTitle(id, saved.title);
          }
        }
        if (ids.length > 0) {
          const activeId = ids[Math.min(session.activeIndex ?? 0, ids.length - 1)];
          await browserTabsStore.switchTab(activeId);
          lensStore.setWebviewReady(true);
          console.log('[LensPreview] Browser session restored');
          return;
        }
      } catch (err) {
        console.error('[LensPreview] Session restore failed, falling back to blank tab:', err);
      }
    }

    console.log('[LensPreview] Creating first browser tab at', bounds);

    try {
      const tabId = await browserTabsStore.openTab(DEFAULT_URL, bounds);
      if (tabId) {
        lensStore.setWebviewReady(true);
        console.log('[LensPreview] First browser tab ready');
      }
    } catch (err) {
      console.error('[LensPreview] Failed to create first tab:', err);
    }
  }

  // Use onMount instead of $effect to avoid re-running on reactive state changes.
  // This ensures theme changes, config updates, etc. don't destroy/recreate the webview.
  onMount(async () => {
    if (setupDone) return;
    setupDone = true;

    // Listen for URL change events — route by tabId to browser tabs store
    unlistenUrl = await listen('lens-url-changed', (event) => {
      const tabId = event.payload?.tabId;
      const url = event.payload?.url;

      if (tabId && url) {
        browserTabsStore.setTabUrl(tabId, url);
        browserTabsStore.setTabLoading(tabId, false);
      }

      // Sync active tab URL to lensStore for backward compat
      if ((!tabId || tabId === browserTabsStore.activeTabId) && url) {
        lensStore.setUrl(url);
        lensStore.setInputUrl(url);
      }
      lensStore.setLoading(false);
    });

    // Listen for MCP browser_open requests to create new tabs
    unlistenOpenTab = await listen('lens-open-tab', (event) => {
      const url = event.payload?.url;
      if (url) {
        const bounds = getAbsoluteBounds();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          browserTabsStore.openTab(url, bounds).then(() => syncBounds());
        }
      }
    });

    // Per-tab loading state from Tauri page-load Started/Finished → tab spinner
    // + the per-nav progress bar under the toolbar.
    unlistenLoading = await listen('lens-loading-changed', (event) => {
      const tabId = event.payload?.tabId;
      if (!tabId) return;
      const loading = event.payload?.loading === true;
      browserTabsStore.setTabLoading(tabId, loading);
      if (tabId === browserTabsStore.activeTabId) {
        lensStore.setLoading(loading);
      }
    });

    // Listen for page title changes from child WebView2 instances
    unlistenTitle = await listen('lens-title-changed', (event) => {
      const tabId = event.payload?.tabId;
      const title = event.payload?.title;
      if (tabId && title) {
        browserTabsStore.setTabTitle(tabId, title);
      }
    });

    // Favicons from WebView2 FaviconChanged → tab strip icons
    unlistenFavicon = await listen('lens-favicon-changed', (event) => {
      const tabId = event.payload?.tabId;
      if (tabId) {
        browserTabsStore.setTabFavicon(tabId, event.payload?.faviconUri || null);
      }
    });

    // Real navigation history state from WebView2 HistoryChanged →
    // back/forward button enablement
    unlistenHistoryState = await listen('lens-history-changed', (event) => {
      const tabId = event.payload?.tabId;
      if (tabId) {
        browserTabsStore.setTabHistoryState(
          tabId,
          event.payload?.canGoBack === true,
          event.payload?.canGoForward === true
        );
      }
    });

    // TLS certificate errors → address-bar security chip error state.
    // (WebView2 still renders its own built-in interstitial in the tab.)
    unlistenCertError = await listen('lens-cert-error', (event) => {
      const tabId = event.payload?.tabId;
      if (tabId) {
        browserTabsStore.setTabCertError(tabId, true);
      }
    });

    // HTML5 fullscreen (ICoreWebView2 ContainsFullScreenElementChanged) → the
    // active webview fills the whole window while fullscreen; pane bounds restore
    // on exit. Only the active tab can be fullscreen (others are parked off-screen).
    unlistenFullscreen = await listen('lens-fullscreen-changed', (event) => {
      const tabId = event.payload?.tabId;
      const fullscreen = event.payload?.fullscreen === true;
      if (tabId && tabId !== browserTabsStore.activeTabId) return;
      isFullscreen = fullscreen;
      if (fullscreen) {
        lensResizeWebview(0, 0, window.innerWidth, window.innerHeight).catch(() => {});
      } else {
        syncBounds();
      }
    });

    // Per-tab audio state (ICoreWebView2_8) → speaker icon in the tab strip.
    unlistenAudioState = await listen('lens-audio-state', (event) => {
      const tabId = event.payload?.tabId;
      if (!tabId) return;
      if (typeof event.payload?.audible === 'boolean') {
        browserTabsStore.setTabAudible(tabId, event.payload.audible);
      }
      if (typeof event.payload?.muted === 'boolean') {
        browserTabsStore.setTabMuted(tabId, event.payload.muted);
      }
    });

    // Listen for window.open()/OAuth popups from child WebView2 instances —
    // the Rust NewWindowRequested handler emits these so we can open them as tabs.
    unlistenNewWindow = await listen('lens-new-window', (event) => {
      const uri = event.payload?.uri;
      if (!uri || uri === 'about:blank') return;
      const bounds = getAbsoluteBounds();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        // Re-clamp popup tab to the browser pane so it can't cover the panel.
        browserTabsStore.openTab(uri, bounds).then(() => syncBounds());
      }
    });

    // Listen for MCP-initiated tab switches (browser_action tab_switch)
    unlistenFocusTab = await listen('lens-focus-tab', (event) => {
      const tabId = event.payload?.tabId;
      if (tabId) {
        // Update frontend tab bar to reflect the active tab
        browserTabsStore.setActiveTabDirect(tabId);
      }
    });

    // Observe container resize — this serves two purposes:
    // 1. Sync webview bounds when the panel is resized
    // 2. Trigger first tab creation when the container becomes visible
    //    (it starts with display:none if a file tab is active on load)
    if (containerEl) {
      const observer = new ResizeObserver(() => {
        if (!lensStore.webviewReady) {
          // Container just became visible — create the first tab
          createFirstTab();
        } else {
          // Normal resize — sync bounds
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => { rafId = null; syncBounds(); });
        }
      });
      observer.observe(containerEl);
      resizeObserver = observer;
    }

    await createFirstTab();
  });

  onDestroy(() => {
    clearTimeout(loadingTimer);
    clearTimeout(detectionTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (unlistenUrl) {
      unlistenUrl();
      unlistenUrl = null;
    }
    if (unlistenOpenTab) {
      unlistenOpenTab();
      unlistenOpenTab = null;
    }
    if (unlistenTitle) {
      unlistenTitle();
      unlistenTitle = null;
    }
    if (unlistenFocusTab) {
      unlistenFocusTab();
      unlistenFocusTab = null;
    }
    if (unlistenNewWindow) {
      unlistenNewWindow();
      unlistenNewWindow = null;
    }
    if (unlistenFavicon) {
      unlistenFavicon();
      unlistenFavicon = null;
    }
    if (unlistenHistoryState) {
      unlistenHistoryState();
      unlistenHistoryState = null;
    }
    if (unlistenCertError) {
      unlistenCertError();
      unlistenCertError = null;
    }
    if (unlistenAudioState) {
      unlistenAudioState();
      unlistenAudioState = null;
    }
    if (unlistenFullscreen) {
      unlistenFullscreen();
      unlistenFullscreen = null;
    }
    if (unlistenLoading) {
      unlistenLoading();
      unlistenLoading = null;
    }
    lensCloseAllTabs().catch(() => {});
    browserTabsStore.clearAll();
    lensStore.setWebviewReady(false);
    setupDone = false;
    creatingFirstTab = false;
  });
</script>

<div class="lens-preview" bind:this={containerEl}>
  {#if !lensStore.webviewReady}
    <div class="lens-loading">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <p>Loading browser...</p>
    </div>
  {/if}
</div>

<style>
  .lens-preview {
    flex: 1;
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .lens-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--muted);
  }

  .lens-loading svg {
    opacity: 0.3;
  }

  .lens-loading p {
    font-size: 13px;
    margin: 0;
  }
</style>
