/**
 * sandbox-preview.svelte.js -- live preview of an app being built (multi-window).
 *
 * Mirrors a Tauri app Voice Mirror launched (by its CDP remote-debugging port).
 * The actual capture is WGC window capture (services/sandbox_stream.rs) — the
 * REAL app window at true size, the same surface the AI sees via sandbox_*.
 *
 * Multi-window: a Tauri app has several windows (the pill, a settings window, a
 * dialog…). This store tracks them all (`windows`) and FOLLOWS THE WINDOW CLAUDE
 * IS DRIVING: every snapshot publishes the OS window it acted on
 * (`sandbox_active_hwnd`), and the preview mirrors exactly that — so the human
 * watches precisely what Claude is doing, by construction, not by guessing. You
 * can still override manually via the switcher (`switchTo`).
 *
 * State split: `active` (a session is running) vs `visible` (the panel is shown).
 * Hiding keeps the session alive so toggling vs the Browser is instant.
 */
import { emit, listen } from '@tauri-apps/api/event';
import {
  sandboxStreamStart,
  sandboxStreamStop,
  sandboxListWindows,
  isWindowAlive,
  probePort,
} from '../api.js';
import { unwrapResult } from '../utils.js';
import { projectStore } from './project.svelte.js';

// Window-list refresh / disconnect-detection cadence. The backend's event-driven
// window-follow (`sandbox-follow-target`) now drives WHICH window we mirror, so
// this poll is only a SLOW reconciliation backstop (switcher list + dead-port
// detection + closed-window recovery), not the follow mechanism.
const POLL_INTERVAL = 2000;

function createSandboxPreviewStore() {
  let active = $state(false);
  let visible = $state(false);
  // Layout mode: maximized fills the center content area (the same region the
  // Browser overlay occupies); restored docks it in the narrow side column.
  // Default to maximized so a freshly-opened preview is big, not crammed.
  let maximized = $state(true);
  let cdpPort = $state(null);
  // NATIVE session: a non-CDP desktop app (egui/iced) mirrored by HWND. No CDP
  // port, no window-list switcher — liveness is "does the HWND still exist".
  let native = $state(false);
  // WEB session: a plain web app (vite/next/CRA — no CDP, no OS window to
  // mirror). Rendered by EMBEDDING its dev-server URL in an iframe (the Bolt
  // DIY / Onlook pattern) — the app renders live in-panel, no capture needed.
  // Liveness is "is the dev port still listening".
  let web = $state(false);
  let webUrl = $state('');
  let webPort = null; // dev-server port backing the web session (liveness probe)
  let streamUrl = $state('');
  let loading = $state(false);
  let error = $state('');
  /** @type {Array<{hwnd:number,title:string,visible?:boolean}>} */
  let windows = $state([]);
  let currentHwnd = $state(null);
  // True when the followed app window closed and NO other VISIBLE window remains
  // to mirror — drives a clear "App window closed" empty state instead of an
  // infinite "Waiting…" spinner. Cleared whenever a real window is shown again.
  let noWindow = $state(false);

  // Non-reactive bookkeeping for polling.
  let pollTimer = null;
  // Unlisten handle for the backend `sandbox-follow-target` event (the event-driven
  // window-follow). Registered per session in open(), torn down in close().
  let followUnlisten = null;
  // When the user manually picks a window from the switcher, stop auto-following
  // Claude until they go back to a session/window or reopen the preview.
  let userPinned = false;
  // Consecutive failures to list windows = the CDP debug port is unreachable
  // (the app / its dev server stopped). A few in a row → surface "disconnected".
  let listFailCount = 0;
  // The last dev-server CDP port we auto-opened for. Lives in the store (not a
  // component) so a LensWorkspace remount / status-flap can't re-fire open() and
  // pop the panel back up after the user hid it. Persists for the app lifetime.
  let lastAutoPort = null;
  // The user explicitly hid the panel (toggle/X) — don't let auto-open re-show it
  // for the same port until they reopen it or a different app launches.
  let userHidden = false;
  // True when this session was opened by sandbox_attach (an external app the agent
  // launched), not by a Voice Mirror dev server — so the auto-sync must NOT close
  // it when no dev-server CDP port is active.
  let attached = false;
  // The user clicked the App tab with no session and no remembered preference —
  // show an in-panel confirmation ("Start the dev server?") instead of silently
  // launching it. Cleared once they choose (Start / Not now) or a session opens.
  let confirmStart = $state(false);

  function setStreamUrl(url) {
    // Cache-bust so the <img> reconnects when we re-target the stream to a
    // different window (the MJPEG endpoint still matches "/stream").
    streamUrl = url ? `${url}?t=${Date.now()}` : '';
  }

  /** Start (or re-target) the WGC mirror. `hwnd` null = the app's main window. */
  async function startStream(hwnd) {
    loading = true;
    error = '';
    try {
      const res = await sandboxStreamStart(cdpPort, hwnd ?? null);
      const data = unwrapResult(res);
      if (data?.url) {
        setStreamUrl(data.url);
        if (data.hwnd != null) currentHwnd = data.hwnd;
        // We're mirroring a window again — leave the "no window" empty state.
        noWindow = false;
        listFailCount = 0;
      } else {
        error = 'Failed to start the App Preview.';
      }
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  /**
   * Obey the backend's event-driven window-follow. The Rust `window_follow`
   * service installs an OS focus hook (`SetWinEventHook`) + a most-recent-action
   * arbiter (human focus vs Claude's drive) and emits `sandbox-follow-target`
   * whenever the window we should mirror changes. The frontend just follows that
   * event — no polling, no latency, no CDP-list gate. A manual switcher choice
   * (`userPinned`) still suppresses it.
   */
  async function setupFollowListener() {
    if (followUnlisten) return;
    followUnlisten = await listen('sandbox-follow-target', (e) => {
      if (userPinned) return; // a manual switcher choice wins until reopened
      const hwnd = e?.payload?.hwnd;
      if (hwnd == null) return;
      noWindow = false;
      currentHwnd = hwnd;
      startStream(hwnd);
    });
  }

  /**
   * SLOW reconciliation backstop. The backend event drives follow; this poll only
   *   1. refreshes the window list for the switcher,
   *   2. detects a dead CDP port (the app/dev-server stopped) → disconnect state,
   *   3. recovers if the window we're mirroring VANISHED before the backend
   *      repointed us (a missed event) — re-target a surviving visible window.
   * It no longer queries `sandbox_active_hwnd` or follows the foreground per-tick.
   */
  async function refreshWindows() {
    if (!active || cdpPort == null) return;

    // Fetch the live window list. A THROW or non-array result means the CDP debug
    // port is unreachable — i.e. the app (or its dev server) on that port has
    // STOPPED (e.g. you closed TaskDeck, then opened a different app).
    let list = null;
    try {
      const res = await sandboxListWindows(cdpPort);
      const data = unwrapResult(res);
      if (Array.isArray(data)) list = data;
    } catch {
      list = null;
    }

    if (list == null) {
      // After a few consecutive misses (ignore a one-off blip), drop the STALE
      // frame and surface the disconnected state — never keep lying with the last
      // app's picture. The "Open app" button relaunches the current project.
      listFailCount += 1;
      if (listFailCount >= 3 && !noWindow) {
        noWindow = true;
        currentHwnd = null;
        streamUrl = ''; // clears the stale frame → component resets hasFrame
        windows = []; // drop the ghost window list (the app is gone) so the picker
        // doesn't offer a dead window and "Open app" falls through to a real relaunch
      }
      return;
    }
    listFailCount = 0;
    windows = list;

    // Don't fight a manual switcher choice — and the backend event handles normal
    // follow, so we only reconcile a CLOSED followed window here as a backstop.
    if (userPinned) return;

    // RECOVERY: we'd already given up ("The app window was closed.") but the
    // app is back with a mirrorable window — the CDP port went down and came
    // back with new windows. Classic case: `tauri dev` restarts the app (new
    // PID + HWND) right after a fresh build writes its gen/ files, so the
    // window we first mirrored closes and a replacement appears seconds later.
    // Auto re-target instead of stranding the user on the empty state needing
    // an "Open app" click.
    if (noWindow) {
      const revive = windows.filter((w) => w.visible);
      if (revive.length > 0) {
        noWindow = false;
        startStream(revive[0].hwnd);
      }
      return;
    }

    // The window we're mirroring has CLOSED (e.g. you closed Settings) and the
    // backend close-retarget event hasn't reached us. `windows` is the
    // authoritative LIVE window list for the app's process — if currentHwnd isn't
    // in it, the window is genuinely gone. Re-target to another VISIBLE window
    // rather than freezing on its last (stale) frame.
    if (currentHwnd != null && !windows.some((w) => w.hwnd === currentHwnd)) {
      const visible = windows.filter((w) => w.visible && w.hwnd !== currentHwnd);
      if (visible.length > 0) {
        // Prefer a real, presentable window — pick the first one.
        startStream(visible[0].hwnd);
      } else {
        // Nothing presentable to mirror — show a clear empty state instead of
        // spinning forever, and DROP the stale frame. (All cleared the moment any
        // window is shown again.)
        noWindow = true;
        currentHwnd = null;
        streamUrl = ''; // clears the stale frame → component resets hasFrame
      }
    }
  }

  /**
   * NATIVE-session liveness backstop: no CDP port to probe, no window list — the
   * mirror is one HWND, so liveness is simply "does that window still exist".
   * When it's gone (the app closed), surface the empty state.
   */
  async function refreshNative() {
    if (!active || !native || currentHwnd == null) return;
    let alive = true;
    try {
      const res = await isWindowAlive(currentHwnd);
      alive = unwrapResult(res)?.alive !== false;
    } catch {
      // Probe failure — don't tear down on a one-off; keep showing.
      return;
    }
    if (!alive) {
      noWindow = true;
      currentHwnd = null;
      streamUrl = ''; // drop the stale frame → clear "app window closed"
    }
  }

  /**
   * WEB-session liveness backstop: no HWND, no CDP — the embed is an iframe on
   * the dev-server URL, so liveness is "is the dev port still listening". A few
   * consecutive misses (not one — a vite restart blips the port) → surface a
   * clear "server stopped" error with a Try-again instead of a frozen iframe.
   */
  async function refreshWeb() {
    if (!active || !web || webPort == null) return;
    let listening = true;
    try {
      const res = await probePort(webPort);
      listening = unwrapResult(res)?.listening !== false;
    } catch {
      return; // probe transport failure — don't tear down on a one-off
    }
    if (!listening) {
      listFailCount += 1;
      if (listFailCount >= 3) {
        stopPolling();
        webUrl = ''; // drop the dead iframe
        error = 'The dev server stopped.';
      }
    } else {
      listFailCount = 0;
    }
  }

  function startPolling() {
    stopPolling();
    const tick = native ? refreshNative : web ? refreshWeb : refreshWindows;
    pollTimer = setInterval(tick, POLL_INTERVAL);
    tick();
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    get active() { return active; },
    get visible() { return visible; },
    get maximized() { return maximized; },
    get cdpPort() { return cdpPort; },
    get streamUrl() { return streamUrl; },
    get loading() { return loading; },
    get error() { return error; },
    get windows() { return windows; },
    get currentHwnd() { return currentHwnd; },
    get noWindow() { return noWindow; },
    get confirmStart() { return confirmStart; },
    get native() { return native; },
    get web() { return web; },
    get webUrl() { return webUrl; },

    /**
     * Begin a WEB live preview: embed the dev-server URL in an iframe (a plain
     * web app has no OS window to mirror — the render surface IS the page).
     * Idempotent for the same URL: just re-shows the panel.
     * @param {string} url  - http://localhost:<port> the dev server announced
     * @param {number} port - the dev port, for the liveness probe
     */
    openWeb(url, port) {
      if (!url) return;
      if (active && web && webUrl && webUrl.startsWith(url)) {
        visible = true;
        return;
      }
      userHidden = false;
      cdpPort = null;
      native = false;
      web = true;
      webPort = port ?? null;
      active = true;
      visible = true;
      confirmStart = false;
      maximized = true;
      attached = false;
      userPinned = false;
      currentHwnd = null;
      windows = [];
      noWindow = false;
      listFailCount = 0;
      error = '';
      loading = false;
      streamUrl = '';
      webUrl = url;
      startPolling();
    },

    /**
     * Begin a NATIVE live preview: mirror the OS window `hwnd` directly via WGC
     * (no CDP port), for a native desktop app (egui/iced) launched by its own
     * build command. Liveness is the window's existence, not a CDP port.
     * @param {number} hwnd
     */
    async openNative(hwnd) {
      if (!hwnd) return;
      userHidden = false;
      cdpPort = null; // native — no CDP
      native = true;
      active = true;
      visible = true;
      confirmStart = false;
      maximized = true;
      attached = false;
      userPinned = false;
      currentHwnd = hwnd;
      windows = [];
      noWindow = false;
      listFailCount = 0;
      error = '';
      loading = true;
      try {
        // port 0 = no CDP; the backend WGC-mirrors the explicit HWND.
        const res = await sandboxStreamStart(0, hwnd);
        const data = unwrapResult(res);
        if (data?.url) {
          setStreamUrl(data.url);
        } else {
          error = 'Failed to start the App Preview.';
        }
      } catch (err) {
        error = err?.message || String(err);
      } finally {
        loading = false;
      }
      startPolling();
    },

    /**
     * Begin a live preview for the app on `port` (CDP) and show it. Idempotent:
     * re-opening the same active port just re-shows the panel (no stream churn).
     * @param {number} port
     * @param {{ attached?: boolean }} [opts] - `attached` marks an external app
     *   (from sandbox_attach) so the dev-server auto-sync won't tear it down.
     */
    async open(port, opts = {}) {
      if (!port) return;
      userHidden = false; // an explicit open clears any prior user-hide
      if (active && cdpPort === port) {
        attached = opts.attached ?? attached;
        visible = true;
        return;
      }
      cdpPort = port;
      active = true;
      visible = true;
      confirmStart = false; // a live session supersedes any pending start prompt
      // A newly launched app opens maximized (fills the preview area) so it's not
      // shrunk into the narrow side strip. User can restore it to the side column.
      maximized = true;
      attached = opts.attached ?? false;
      userPinned = false;
      currentHwnd = null;
      windows = [];
      noWindow = false;
      listFailCount = 0;
      await setupFollowListener(); // obey the backend's event-driven follow
      await startStream(null); // main window
      startPolling();
    },

    /**
     * Reconcile the auto-open state with the active dev-server CDP port (called
     * reactively from LensWorkspace). Opens once per new port, respects an
     * explicit user-hide, and tears down only its OWN auto session (never an
     * attached external app). The guard lives here so a component remount can't
     * re-trigger it.
     * @param {number|null} port - active dev-server CDP port, or null if none.
     */
    syncAuto(port) {
      if (port) {
        if (port === lastAutoPort) return; // already reacted to this port
        lastAutoPort = port;
        if (userHidden && port === cdpPort) return; // user hid this one — leave it
        this.open(port);
      } else {
        lastAutoPort = null;
        // Only close an auto (dev-server) session. NEVER close an attached
        // external app — NOR a NATIVE or WEB session: neither has a CDP port,
        // so this sync (which tracks the active CDP port) would immediately
        // tear it down the instant it opened. Each has its own liveness check.
        if (active && !attached && !native && !web) this.close();
      }
    },

    /** Show the panel (session must already be active). */
    show() {
      if (active) {
        userHidden = false;
        visible = true;
        noWindow = false;
        listFailCount = 0;
      }
    },

    /**
     * User-initiated start — the "App" tab as an entry point (not just Claude's
     * sandbox_start). With NO session running, launch the CURRENT project's app
     * into the preview: show the panel (a "Starting live preview…" state) and emit
     * `sandbox-start-request`, which LensWorkspace handles (detectDevServers →
     * devServerManager.start). Once the dev server is up, syncAuto → open() takes
     * over with the live stream.
     */
    async requestStart() {
      if (active) { this.show(); return; }
      confirmStart = false;
      visible = true;
      userHidden = false;
      error = ''; // a retry supersedes a previous launch failure
      await emit('sandbox-start-request', { force: true });
    },

    /**
     * A launch this panel may be waiting on was REFUSED or died before any
     * session opened (no dev server detected, crash loop, spawn failure, port
     * never bound…). Surface the reason in-panel instead of leaving
     * "Starting App Preview…" up forever — nothing else would ever resolve it,
     * because a refused launch never registers a CDP port for syncAuto.
     * No-op when a session is active (the live stream's own disconnect
     * detection owns that state).
     * @param {string} reason
     */
    launchFailed(reason) {
      if (active) return;
      confirmStart = false;
      loading = false;
      error = reason || 'The launch failed.';
    },

    /**
     * USER clicked the App tab with no session running. Unlike the AI's
     * `sandbox_start` (which goes straight through `sandbox-start-request`), a
     * human click must NOT silently spin up a dev server. If this project has a
     * remembered "always auto-start" preference, start immediately; otherwise
     * show an in-panel confirmation (Start / Not now / Always) — see SandboxPreview.
     */
    async promptStart() {
      if (active) { this.show(); return; }
      const remembered = projectStore.activeProject?.autoStartPreview;
      if (remembered === true) {
        await this.requestStart();
        return;
      }
      // Reveal the panel showing the confirmation, but don't launch anything yet.
      visible = true;
      userHidden = false;
      confirmStart = true;
    },

    /**
     * Confirm the in-panel start prompt. `always` persists a per-project
     * preference so future App-tab clicks auto-start without prompting.
     * @param {boolean} [always]
     */
    async confirmStartNow(always = false) {
      if (always) {
        projectStore.updateActiveField('autoStartPreview', true);
      }
      confirmStart = false;
      await this.requestStart();
    },

    /** Dismiss the in-panel start prompt without launching ("Not now"). */
    cancelStart() {
      confirmStart = false;
      visible = false;
    },

    /**
     * Recover the preview from the disconnected/empty state.
     *
     * If the app is actually STILL RUNNING (one or more live VISIBLE windows are
     * available), RE-ATTACH to one — re-launching the dev server would no-op when
     * it's already up, making the "Open app" button look dead. Only when NO visible
     * window remains (the app is truly gone) do we relaunch via the dev-server flow:
     * LensWorkspace listens for `sandbox-start-request` and runs detectDevServers →
     * devServerManager.start (frontend-emitted events ARE caught by that `listen`).
     */
    async openApp() {
      const liveVisible = windows.filter((w) => w.visible);
      if (liveVisible.length > 0) {
        // The app is alive — re-mirror a live window instead of relaunching.
        noWindow = false;
        userPinned = false;
        startStream(liveVisible[0].hwnd);
        return;
      }
      await emit('sandbox-start-request', { force: true });
    },

    /** Hide the panel but keep the screencast running (instant to re-show). */
    hide() {
      userHidden = true;
      visible = false;
    },

    /**
     * Toggle between maximized (center overlay, fills the preview area) and
     * restored (narrow side column). Read by LensWorkspace to pick the layout.
     */
    toggleMaximize() {
      maximized = !maximized;
    },

    /** Explicitly set the layout mode (true = maximized center overlay). */
    setMaximized(value) {
      maximized = !!value;
    },

    /**
     * Switch the mirror to a specific window (from the switcher dropdown). Pins
     * the choice so we stop auto-following Claude until the preview is reopened.
     */
    switchTo(hwnd) {
      if (hwnd == null) return;
      userPinned = true;
      startStream(Number(hwnd));
    },

    /** Fully tear down: hide and stop the screencast (app stopped/closed). */
    close() {
      const port = cdpPort;
      stopPolling();
      if (followUnlisten) {
        followUnlisten();
        followUnlisten = null;
      }
      const wasNative = native;
      const wasWeb = web;
      active = false;
      visible = false;
      streamUrl = '';
      loading = false;
      error = '';
      cdpPort = null;
      native = false;
      web = false;
      webUrl = '';
      webPort = null;
      windows = [];
      currentHwnd = null;
      noWindow = false;
      listFailCount = 0;
      userPinned = false;
      attached = false;
      userHidden = false;
      confirmStart = false;
      // Native mirror runs off an MJPEG/WGC capture with no CDP port — stop()
      // ignores the port and tears down window_stream globally, so pass 0.
      // A WEB session is just an iframe: nothing to stop on the backend.
      if ((port || wasNative) && !wasWeb) {
        sandboxStreamStop(port || 0).catch(() => {});
      }
    },
  };
}

export const sandboxPreviewStore = createSandboxPreviewStore();
