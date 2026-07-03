<script>
  /**
   * SandboxPreview.svelte -- live, true-size view of the app being built.
   *
   * Shows a CDP screencast (served as MJPEG by services/sandbox_stream.rs) of the
   * real running app window. You and the AI look at the same surface: the AI sees
   * it via the sandbox_* MCP tools, you see it here. The <img> points at the
   * MJPEG `/stream` endpoint; object-fit:contain keeps the app at its true aspect
   * (a small pill app shows centered, not stretched).
   */
  import { sandboxPreviewStore } from '../../../lib/stores/sandbox-preview.svelte.js';
  import { projectStore } from '../../../lib/stores/project.svelte.js';
  import { devServerManager } from '../../../lib/stores/dev-server-manager.svelte.js';
  import { outputStore } from '../../../lib/stores/output.svelte.js';
  import { logPreview } from '../../../lib/api.js';

  const url = $derived(sandboxPreviewStore.streamUrl);
  const loading = $derived(sandboxPreviewStore.loading);
  const error = $derived(sandboxPreviewStore.error);
  const windows = $derived(sandboxPreviewStore.windows);
  const currentHwnd = $derived(sandboxPreviewStore.currentHwnd);
  const noWindow = $derived(sandboxPreviewStore.noWindow);
  // Whether the body shows the "Start the dev server?" confirmation (user clicked
  // the App tab with no session and no remembered preference).
  const confirmStart = $derived(sandboxPreviewStore.confirmStart);
  const projectName = $derived(projectStore.activeProject?.name || 'this project');
  // "Always start automatically for this project" — persisted on Start if ticked.
  let alwaysStart = $state(false);

  // The MJPEG stream serves immediately but is empty until the app window exists
  // (a `tauri dev` app compiles Rust first, so its window can appear minutes
  // later). Track the first painted frame so we can show a clear waiting state.
  let hasFrame = $state(false);
  // Reset the frame flag whenever the stream URL changes (new session).
  $effect(() => {
    url;
    hasFrame = false;
  });

  // Frame-timeout safety net: if a stream URL is set but no frame paints within
  // ~5s, treat it as "no window" so the user gets a clear empty state + an
  // "Open app" button instead of an infinite spinner. (Covers the case where the
  // backend re-targets to a non-presentable window that never produces frames.)
  const FRAME_TIMEOUT_MS = 5000;
  let stalled = $state(false);
  $effect(() => {
    // Re-arm whenever the stream URL changes or a frame arrives.
    stalled = false;
    if (!url || hasFrame) return;
    const t = setTimeout(() => {
      if (!hasFrame) stalled = true;
    }, FRAME_TIMEOUT_MS);
    return () => clearTimeout(t);
  });

  // Show the clear empty state (not the spinner) once the store knows there's no
  // mirrorable window, or the first-load wait has timed out.
  const showEmpty = $derived(noWindow || stalled);

  // ── Build-output tail while a launch is in flight (Phase 2: honest states) ──
  // A cold `tauri dev` build compiles for minutes; a bare "Starting…" spinner
  // reads as "hung". The launch's terminal output already streams into its
  // project channel — mirror the last few lines right here so the wait
  // narrates itself (npm install / cargo compile / vite ready / errors).
  const startingServer = $derived.by(() => {
    let best = null;
    let bestKey = null;
    for (const [pp, s] of devServerManager.servers) {
      if (s.status === 'starting' && (!best || (s.startedAt || 0) > (best.startedAt || 0))) {
        best = s;
        bestKey = pp;
      }
    }
    // SNAPSHOT, not the live reference. The manager's Map entries are plain
    // objects mutated in place (reactivity comes from reassigning the Map) —
    // returning the same reference made every later field update INVISIBLE
    // to dependents (outputChannel lands a beat after 'starting', so the
    // build tail + wiring diagnostic never armed; found live 2026-07-04).
    // A fresh shallow copy per recompute keeps dependents tracking.
    return best ? { ...best, projectPath: bestKey } : null;
  });
  const TAIL_LINES = 8;
  const buildTail = $derived.by(() => {
    const ch = startingServer?.outputChannel;
    if (!ch) return [];
    const entries = outputStore.projectEntries[ch] || [];
    return entries.slice(-TAIL_LINES);
  });

  // The project-channel stream only flows once the output store listens —
  // normally the Output panel's mount does that, but the preview must not
  // depend on the user having opened that tab. startListening is idempotent.
  //
  // Diagnostics: a live 47s tauri-vanilla build (2026-07-03) showed an EMPTY
  // tail while the backend channel demonstrably streamed — log the wiring
  // once per launch so the next occurrence pinpoints which link dropped
  // (frontend store empty vs derivation).
  let lastDiagCh = null;
  $effect(() => {
    if (!startingServer) return;
    outputStore.startListening();
    const ch = startingServer.outputChannel;
    if (ch && ch !== lastDiagCh) {
      lastDiagCh = ch;
      setTimeout(() => {
        const n = (outputStore.projectEntries[ch] || []).length;
        logPreview('info', `[panel] build-tail wiring: channel='${ch}' frontend-entries=${n} after 5s`).catch(() => {});
      }, 5000);
    }
  });

  // Elapsed-seconds ticker for the starting state (1s cadence, only while
  // a launch is actually in flight).
  let nowTick = $state(Date.now());
  $effect(() => {
    if (!startingServer) return;
    nowTick = Date.now();
    const t = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(t);
  });
  const startElapsed = $derived(
    startingServer?.startedAt ? Math.max(0, Math.round((nowTick - startingServer.startedAt) / 1000)) : null
  );

  // ── Determinate progress (Nathan's ask: a real 0→100%, not just a glide) ──
  // A cargo build has no knowable total, so we do what browsers do for page
  // loads: estimate against how long the LAST successful launch of this same
  // project took (persisted by the dev-server manager on markRunning). First
  // ever launch → no baseline → indeterminate glide. With a baseline the bar
  // fills 0→90% over the estimate, then jumps: 90%+ once the build is done and
  // we're attaching the mirror, 100% on the first painted frame.
  function readLastLaunchMs(projectPath) {
    if (!projectPath) return null;
    try {
      const v = localStorage.getItem(`vm:lastLaunchMs:${projectPath}`);
      const n = v ? Number(v) : NaN;
      return Number.isFinite(n) && n > 1000 ? n : null;
    } catch {
      return null;
    }
  }
  const baselineMs = $derived(readLastLaunchMs(startingServer?.projectPath));
  // null → indeterminate (glide); a number 0..100 → determinate width.
  const progressPct = $derived.by(() => {
    if (hasFrame) return 100;
    if (startingServer) {
      // Build/launch in flight.
      if (!baselineMs || startElapsed == null) return null; // no estimate → glide
      return Math.min(90, Math.round((startElapsed * 1000 / baselineMs) * 90));
    }
    // Build done (status flipped to running) — mirror is attaching. Hold near
    // the end so the bar reads "almost there" rather than snapping to empty.
    if (loading || !url || !hasFrame) return 95;
    return 100;
  });
  const showProgress = $derived(!confirmStart && !error && !showEmpty && !hasFrame);
</script>

<div class="sandbox-preview">
  <div class="sandbox-header">
    <span class="sandbox-title">
      <span class="live-dot" aria-hidden="true"></span>
      App Preview
      {#if sandboxPreviewStore.cdpPort}
        <span class="port">CDP :{sandboxPreviewStore.cdpPort}</span>
      {/if}
    </span>
    {#if windows.length > 1}
      <!-- Window switcher: pick which app window to mirror (auto-follows new ones). -->
      <select
        class="window-switcher"
        value={currentHwnd}
        onchange={(e) => sandboxPreviewStore.switchTo(e.currentTarget.value)}
        title="Switch which app window is shown"
        aria-label="App window"
      >
        {#each windows as w (w.hwnd)}
          <option value={w.hwnd}>{w.title}</option>
        {/each}
      </select>
    {/if}
    <button
      class="header-btn open-app-btn"
      onclick={() => sandboxPreviewStore.openApp()}
      title="Open / relaunch the app (re-runs the project's dev server)"
      aria-label="Open or relaunch the app"
    >
      <!-- Launch / play-in-window glyph -->
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M10 9l4 3-4 3z" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button
      class="header-btn maximize-btn"
      onclick={() => sandboxPreviewStore.toggleMaximize()}
      title={sandboxPreviewStore.maximized
        ? 'Restore to side panel (dock beside the editor)'
        : 'Maximize (fill the preview area)'}
      aria-label={sandboxPreviewStore.maximized ? 'Restore App Preview to side panel' : 'Maximize App Preview'}
    >
      {#if sandboxPreviewStore.maximized}
        <!-- Restore-to-columns glyph: editor pane + side panel -->
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      {:else}
        <!-- Maximize / expand glyph -->
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />
        </svg>
      {/if}
    </button>
    <button
      class="header-btn close-btn"
      onclick={() => sandboxPreviewStore.hide()}
      title="Hide App Preview (keeps it running — re-open from the App button)"
      aria-label="Hide App Preview"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <div class="sandbox-body">
    {#if showProgress}
      <!-- Launch progress. Determinate (0→100%) when we have a last-launch
           baseline to estimate against; an indeterminate glide on the first
           ever launch (no baseline yet). -->
      <div
        class="progress-track"
        role="progressbar"
        aria-label="App launch progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progressPct ?? undefined}
      >
        {#if progressPct == null}
          <div class="progress-glide"></div>
        {:else}
          <div class="progress-fill" style="width: {progressPct}%"></div>
        {/if}
      </div>
    {/if}
    {#if confirmStart}
      <!-- USER clicked App with no session: confirm before launching a dev server
           (never silently spin one up). "Always" persists a per-project pref. -->
      <div class="sandbox-msg confirm">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M10 9l4 3-4 3z" fill="currentColor" stroke="none" />
        </svg>
        <span>Start the dev server for <strong>{projectName}</strong>?</span>
        <small>This launches the app so you can preview it live here.</small>
        <div class="confirm-actions">
          <button class="open-app-cta" onclick={() => sandboxPreviewStore.confirmStartNow(alwaysStart)}>
            Start
          </button>
          <button class="confirm-dismiss" onclick={() => sandboxPreviewStore.cancelStart()}>
            Not now
          </button>
        </div>
        <label class="confirm-always">
          <input type="checkbox" bind:checked={alwaysStart} />
          Always start automatically for this project
        </label>
      </div>
    {:else if error}
      <!-- The launch was refused or died before a session opened (no dev server
           detected, crash loop, port never bound…). Say WHY + how to recover,
           never an infinite "Starting…". -->
      <div class="sandbox-msg error">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
        </svg>
        <span>{error}</span>
        <small>Full launch log: Output panel → App Preview channel.</small>
        <button class="open-app-cta" onclick={() => sandboxPreviewStore.requestStart()}>
          Try again
        </button>
      </div>
    {:else if showEmpty}
      <!-- An explicit disconnect (the app exited / no mirrorable window, or the
           first-load wait timed out) OVERRIDES a painted stale frame AND the
           "Starting…" wait: show the clear, actionable empty state regardless of
           hasFrame so a dead app never lingers on its last picture. -->
      <div class="sandbox-msg empty">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="14" x2="16" y2="14" />
        </svg>
        <span>{noWindow ? 'The app window was closed.' : 'No app window is open.'}</span>
        <small>Relaunch the app, or pick a window below if one is still open.</small>
        <button class="open-app-cta" onclick={() => sandboxPreviewStore.openApp()}>
          Open app
        </button>
        {#if windows.length > 0}
          <select
            class="window-switcher empty-switcher"
            value={currentHwnd}
            onchange={(e) => sandboxPreviewStore.switchTo(e.currentTarget.value)}
            title="Switch which app window is shown"
            aria-label="App window"
          >
            {#each windows as w (w.hwnd)}
              <option value={w.hwnd}>{w.title}</option>
            {/each}
          </select>
        {/if}
      </div>
    {:else if loading || !url}
      <div class="sandbox-msg starting">
        <span class="spinner" aria-hidden="true"></span>
        <span>
          Starting App Preview{startingServer ? ` — ${startingServer.framework || 'dev server'}${startingServer.port ? ` :${startingServer.port}` : ''}` : ''}…
        </span>
        {#if startElapsed != null}
          <small>{startElapsed}s elapsed{startElapsed > 20 ? ' — a native build can take minutes on first run' : ''}</small>
        {/if}
        {#if buildTail.length > 0}
          <!-- Live tail of the launch's terminal output (its project channel) -->
          <div class="build-tail" role="log" aria-label="Build output">
            {#each buildTail as e (e.id)}
              <div class="tail-line" class:tail-error={e.level === 'ERROR'} class:tail-warn={e.level === 'WARN'}>{e.message}</div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      {#if !hasFrame}
        <div class="sandbox-msg waiting">
          <span class="spinner" aria-hidden="true"></span>
          Waiting for the app window…
          <small>The app is up — attaching the live mirror. If its window is hidden or minimized, show it and it will appear here.</small>
        </div>
      {/if}
      <!-- MJPEG stream of the real app window; onload fires on the first frame. -->
      <img
        class="sandbox-frame"
        class:visible={hasFrame}
        src={url}
        alt="App Preview — live view of the app being built"
        onload={() => { hasFrame = true; }}
      />
    {/if}
  </div>
</div>

<style>
  .sandbox-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border);
  }

  .sandbox-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    height: 30px;
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .sandbox-title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok, #0072b2);
    flex-shrink: 0;
    animation: live-pulse 2s ease-in-out infinite;
  }

  @keyframes live-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .port {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .window-switcher {
    margin-left: auto;
    max-width: 160px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 11px;
    font-family: var(--font-mono);
    outline: none;
    cursor: pointer;
    padding: 0 4px;
  }
  .window-switcher:focus {
    border-color: var(--accent);
  }

  .header-btn {
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
    flex-shrink: 0;
  }

  .header-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sandbox-body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
  }

  .sandbox-frame {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    /* Hidden until the first frame paints, so no broken-image icon shows. */
    display: none;
  }

  .sandbox-frame.visible {
    display: block;
  }

  .sandbox-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
    padding: 16px;
    text-align: center;
  }

  .sandbox-msg small {
    color: var(--muted);
    opacity: 0.7;
    font-size: 11px;
  }

  .sandbox-msg.error {
    color: var(--danger);
  }

  .sandbox-msg.empty {
    color: var(--text);
  }

  .open-app-cta {
    margin-top: 4px;
    padding: 6px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-fg, #fff);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .open-app-cta:hover {
    filter: brightness(1.08);
  }

  .empty-switcher {
    margin: 0;
    max-width: 220px;
  }

  .sandbox-msg.confirm {
    color: var(--text);
    max-width: 360px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .confirm-dismiss {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .confirm-dismiss:hover {
    background: var(--bg-hover);
  }

  .confirm-always {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }
  .confirm-always input {
    cursor: pointer;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid color-mix(in srgb, var(--muted) 40%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: sandbox-spin 0.8s linear infinite;
  }

  .sandbox-msg.starting {
    max-width: min(640px, 90%);
  }

  .progress-track {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    z-index: 2;
  }

  .progress-glide {
    width: 35%;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    animation: progress-glide 1.4s ease-in-out infinite;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 0 2px 2px 0;
    /* Ease the width so estimate ticks + the checkpoint jumps glide smoothly. */
    transition: width 0.6s ease-out;
  }

  @keyframes progress-glide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(390%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-glide { animation: none; width: 100%; opacity: 0.4; }
    .progress-fill { transition: none; }
  }

  .build-tail {
    margin-top: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--muted);
    text-align: left;
    overflow: hidden;
  }

  .tail-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tail-line.tail-error {
    color: var(--danger);
  }

  .tail-line.tail-warn {
    color: var(--warning, #d29922);
  }

  @keyframes sandbox-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot { animation: none; }
    .spinner { animation: none; }
  }
</style>
