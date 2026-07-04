/**
 * dev-server-manager.svelte.js -- Svelte 5 reactive store for dev server lifecycle management.
 *
 * Manages starting/stopping dev servers, port polling, crash detection with
 * crash-loop protection, idle timeouts on project switch, and LRU eviction
 * to cap concurrent running servers.
 */

import { terminalSpawn, terminalInput, terminalKill, probePort, lensNavigate, killPortProcess, sandboxSetActivePort, sandboxClearActivePort, findFreeCdpPort, logPreview, findNativeWindow } from '../api.js';
import { terminalTabsStore } from './terminal-tabs.svelte.js';
import { lensStore } from './lens.svelte.js';
import { toastStore } from './toast.svelte.js';
import { outputStore } from './output.svelte.js';
import { sandboxPreviewStore } from './sandbox-preview.svelte.js';

// -- Constants --
const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 30000;
const SETUP_POLL_TIMEOUT = 300000; // 5 minutes for projects needing pip install
const IDLE_TIMEOUT = 300000; // 5 minutes
const MAX_CONCURRENT = 3;
const CRASH_LOOP_COUNT = 3;
const CRASH_LOOP_WINDOW = 300000; // 5 minutes
// After the initial poll times out we keep watching at a slower cadence rather
// than lying with status='running' — a cold `tauri dev` build can take minutes.
const EXTENDED_POLL_TIMEOUT = 600000; // 10 more minutes of slow watching
// Runtime health re-verification: status='running' must mean a listening port.
const HEALTH_CHECK_INTERVAL = 15000;
const HEALTH_CHECK_MISSES = 2; // consecutive failed probes before demotion
// A 'starting' entry older than this can be force-relaunched (stale start).
const STALE_STARTING_MS = 60000;

/**
 * Log an App-Preview / dev-server lifecycle event to the `preview` output
 * channel (ring buffer + preview.jsonl) so launches are diagnosable after the
 * fact — console.* alone vanishes with the webview. Mirrors to the console.
 * @param {'error'|'warn'|'info'|'debug'} level
 * @param {string} message
 */
function plog(level, message) {
  logPreview(level, message).catch(() => {});
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(`[preview] ${message}`);
}

/**
 * @typedef {Object} ServerState
 * @property {string} status
 * @property {string|null} shellId
 * @property {number|null} port
 * @property {string|null} framework
 * @property {string|null} url
 * @property {number} crashCount
 * @property {number|null} lastCrashTime
 * @property {number} lastActiveTime
 * @property {boolean} crashLoopDetected
 * @property {string|null} outputChannel
 * @property {number|null} cdpPort - CDP remote-debugging port (Tauri apps only), for sandbox preview.
 * @property {number|null} startedAt - When the current 'starting' phase began (stale-start detection).
 * @property {string|null} stopReason - Why the server is stopped (honest-status UX).
 * @property {number} healthMisses - Consecutive failed runtime port probes.
 */

function createDevServerManager() {
  /** @type {Map<string, ServerState>} projectPath -> server state */
  let servers = $state(new Map());

  /** @type {Map<string, number>} projectPath -> setTimeout id for idle */
  const idleTimers = new Map();

  /** @type {Map<string, { interval: number, reject: (err: Error) => void }>} projectPath -> port poll state */
  const pollTimers = new Map();

  /**
   * Get or create server state for a project path.
   * @param {string} projectPath
   * @returns {ServerState}
   */
  function getOrCreateState(projectPath) {
    if (!servers.has(projectPath)) {
      servers.set(projectPath, {
        status: 'stopped',
        shellId: null,
        port: null,
        framework: null,
        url: null,
        startCommand: null,
        crashCount: 0,
        lastCrashTime: null,
        lastActiveTime: Date.now(),
        crashLoopDetected: false,
        outputChannel: null,
        cdpPort: null,
        startedAt: null,
        stopReason: null,
        healthMisses: 0,
      });
      // Trigger reactivity by reassigning
      servers = new Map(servers);
    }
    return servers.get(projectPath);
  }

  /**
   * Update server state and trigger reactivity.
   * @param {string} projectPath
   * @param {Partial<ServerState>} updates
   */
  function updateState(projectPath, updates) {
    const state = servers.get(projectPath);
    if (!state) return;
    Object.assign(state, updates);
    servers = new Map(servers);
  }

  /**
   * Find the least-recently-used idle server for eviction.
   * @returns {string|null} projectPath of the LRU idle server
   */
  function findLRUIdle() {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [pp, state] of servers) {
      if (state.status === 'idle' && state.lastActiveTime < oldestTime) {
        oldest = pp;
        oldestTime = state.lastActiveTime;
      }
    }
    return oldest;
  }

  /**
   * Count currently running or starting servers.
   * @returns {number}
   */
  function countRunning() {
    let count = 0;
    for (const [, state] of servers) {
      // 'starting' must count too: startServer marks the new server 'starting'
      // BEFORE calling evictIfNeeded, so excluding it let concurrent launches
      // exceed MAX_CONCURRENT.
      if (state.status === 'running' || state.status === 'idle' || state.status === 'starting') {
        count++;
      }
    }
    return count;
  }

  /**
   * Poll a port until it's listening or timeout is reached.
   * @param {number} port
   * @param {string} projectPath
   * @returns {Promise<boolean>}
   */
  function pollPort(port, projectPath, timeout = POLL_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(async () => {
        try {
          const result = await probePort(port);
          if (result?.success && result?.data?.listening) {
            clearInterval(interval);
            pollTimers.delete(projectPath);
            resolve(true);
            return;
          }
        } catch {
          // Port not ready yet, keep polling
        }

        if (Date.now() - startTime >= timeout) {
          clearInterval(interval);
          pollTimers.delete(projectPath);
          resolve(false);
        }
      }, POLL_INTERVAL);

      pollTimers.set(projectPath, { interval, reject });
    });
  }

  /**
   * Stop polling for a project's port.
   * @param {string} projectPath
   */
  function cancelPoll(projectPath) {
    const poll = pollTimers.get(projectPath);
    if (poll) {
      clearInterval(poll.interval);
      poll.reject(new Error('cancelled'));
      pollTimers.delete(projectPath);
    }
  }

  /**
   * Clear an idle timer for a project.
   * @param {string} projectPath
   */
  function cancelIdleTimer(projectPath) {
    const timer = idleTimers.get(projectPath);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(projectPath);
    }
  }

  /**
   * Evict the LRU idle server if at capacity.
   */
  async function evictIfNeeded() {
    while (countRunning() >= MAX_CONCURRENT) {
      const lru = findLRUIdle();
      if (!lru) break; // No idle servers to evict
      await stopServer(lru);
    }
  }

  /**
   * Start a dev server for a project.
   *
   * Returns an HONEST outcome (fed back to sandbox_start via the launch ACK):
   * `{ status: 'spawned'|'already-running'|'already-starting'|'refused',
   *    reason?, devPort?, cdpPort?, framework? }`.
   * 'spawned' means the PTY exists and the start command was sent — readiness
   * is watched in the background; status only becomes 'running' when the port
   * actually listens.
   *
   * @param {{ url: string, port: number, framework?: string, startCommand?: string }} server
   * @param {string} projectPath
   * @param {string} [packageManager]
   */
  async function startServer(server, projectPath, packageManager, opts = {}) {
    const state = getOrCreateState(projectPath);
    const label = `${server.framework || 'server'} :${server.port} (${projectPath})`;

    // 'running'/'idle' is only trusted after re-verifying the port listens.
    // A phantom entry (PTY dropped to a shell prompt after the app exited —
    // no shell-exit event, port long gone) used to no-op every relaunch here
    // forever; now it's demoted and the launch proceeds.
    if (state.status === 'running' || state.status === 'idle') {
      let listening = false;
      // Static-frontend Tauri apps have no dev port — their CDP debug port is
      // the liveness signal instead.
      const verifyPort = state.port || state.cdpPort || server.port;
      try {
        const probe = verifyPort ? await probePort(verifyPort) : null;
        listening = !!probe?.data?.listening;
      } catch {
        // Probe failure = can't confirm it's alive = treat as not listening.
      }

      if (!listening) {
        plog('warn', `[launch] ${label}: tracked status='${state.status}' but port :${verifyPort} is NOT listening — demoting stale entry, relaunching`);
        demoteToStopped(projectPath, `port :${verifyPort} was not listening (stale entry)`, { quiet: true });
      } else if (opts.force) {
        // User-initiated relaunch (Open app / App tab) tears the verified-running
        // server down first so it always yields a fresh window.
        plog('info', `[launch] ${label}: force relaunch of a verified-running server`);
        await stopServer(projectPath);
      } else {
        plog('info', `[launch] ${label}: already running (port re-verified listening) — no new launch`);
        return {
          status: 'already-running',
          devPort: state.port,
          cdpPort: state.cdpPort,
          framework: state.framework,
        };
      }
    }

    // A launch already in flight must be left to finish (a relaunch click
    // mid-build must not kill+respawn a compiling app) — UNLESS it's stale:
    // force + 'starting' older than STALE_STARTING_MS gets torn down, which
    // un-wedges the stop-then-start race that used to recreate phantoms.
    if (state.status === 'starting') {
      const age = state.startedAt ? Date.now() - state.startedAt : Infinity;
      if (opts.force && age > STALE_STARTING_MS) {
        plog('warn', `[launch] ${label}: force relaunch of a stale 'starting' entry (${Math.round(age / 1000)}s old)`);
        await stopServer(projectPath);
      } else {
        plog('info', `[launch] ${label}: launch already in flight — coalescing this request into it`);
        return {
          status: 'already-starting',
          devPort: state.port,
          cdpPort: state.cdpPort,
          framework: state.framework,
        };
      }
    }

    // Crash loop protection
    if (state.crashLoopDetected) {
      const reason = `Crash loop detected for ${server.framework || 'server'} (${CRASH_LOOP_COUNT} crashes in ${CRASH_LOOP_WINDOW / 60000}min) — not auto-restarting`;
      plog('warn', `[launch] ${label}: refused — ${reason}`);
      toastStore.addToast({
        message: `Crash loop detected for ${server.framework || 'server'} — not restarting`,
        severity: 'error',
        key: `dev-server-crash-${projectPath}`,
      });
      return { status: 'refused', reason };
    }

    plog('info', `[launch] ${label}: starting (force=${opts.force === true})`);

    // Set status to 'starting' synchronously to prevent race conditions
    updateState(projectPath, {
      status: 'starting',
      port: server.port,
      framework: server.framework || null,
      url: server.url,
      startCommand: server.startCommand || null,
      // setupCommands intentionally not stored — venv persists after first setup, restart doesn't need it
      lastActiveTime: Date.now(),
      startedAt: Date.now(),
      stopReason: null,
      healthMisses: 0,
    });

    // Evict LRU if at capacity (after marking as starting so guard check works)
    await evictIfNeeded();

    // Build output channel label
    const folderName = projectPath.split(/[/\\]/).filter(Boolean).pop() || 'project';
    // Port 0 = static-frontend Tauri app (no dev server) — label without it.
    const channelLabel = server.framework
      ? (server.port ? `${folderName} (${server.framework} :${server.port})` : `${folderName} (${server.framework})`)
      : `${folderName} (:${server.port})`;

    // Register project output channel (before spawn so channel exists when output starts)
    try {
      await outputStore.registerProjectChannel(channelLabel, projectPath, server.framework, server.port);
    } catch (err) {
      console.warn('[dev-server-manager] Failed to register output channel:', err);
    }
    updateState(projectPath, { outputChannel: channelLabel });

    // For Tauri apps, enable CDP remote debugging so the sandbox tools (and the
    // AI) can see/drive the real app window at its true size. The env var is
    // inherited down the npm -> cargo -> app.exe chain to the built WebView2 app.
    // The port comes from the backend's allocator (bind-tested free, reserved
    // against concurrent launches, never the host's own 9222) — the old derived
    // formula `9223 + (port % 1000)` collided for dev ports 1000 apart
    // (3000/4000, 1420/2420) and was duplicated in JS + Rust.
    const isTauri = (server.framework || '').toLowerCase() === 'tauri';
    let cdpPort = null;
    if (isTauri) {
      try {
        const r = await findFreeCdpPort();
        cdpPort = r?.data?.port ?? null;
      } catch {
        // Allocator unreachable — fall through to the legacy derivation.
      }
      if (cdpPort) {
        plog('info', `[launch] ${label}: allocated CDP debug port :${cdpPort}`);
      } else {
        // Last resort: launching with NO debug port would silently kill the
        // whole see-and-drive loop, so the legacy formula beats nothing.
        cdpPort = 9223 + (server.port % 1000);
        plog('warn', `[launch] ${label}: find_free_cdp_port failed — falling back to derived CDP port :${cdpPort}`);
      }
    }
    // WebView2 browser args (one env var, SPACE-SEPARATED). Alongside the CDP
    // remote-debugging port we disable Chromium's occlusion/background throttling:
    // when the dev app sits behind Voice Mirror it is "occluded", and Chromium
    // throttles (or stops) its rendering — which froze the WGC live preview on a
    // STALE frame (it only repainted when the window regained focus). Turning the
    // throttling off keeps the app painting while occluded, so WGC stays live.
    const spawnEnv = cdpPort
      ? {
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
            `--remote-debugging-port=${cdpPort}` +
            ' --disable-features=CalculateNativeWinOcclusion' +
            ' --disable-backgrounding-occluded-windows' +
            ' --disable-renderer-backgrounding' +
            ' --disable-background-timer-throttling',
        }
      : null;
    if (cdpPort) updateState(projectPath, { cdpPort });

    // Free the target port(s) before launching — the fix for the recurring
    // "Port X already in use" restart failure. taskkill /T of the tracked shell only
    // cleans up processes VM still knows about; when VM crashed/hung last time,
    // kill_all never ran and an orphaned vite (+ Tauri app.exe) keeps the port bound.
    // The servers Map is empty on the next launch, so without this we'd spawn straight
    // into a held port → `npm run dev` dies → the preview stays empty and the user has
    // to hunt down and kill processes by hand. killPortProcess (netstat→PID→taskkill
    // /F) makes every launch self-healing regardless of what VM tracked.
    try {
      const probe = server.port ? await probePort(server.port) : null;
      if (probe?.data?.listening) {
        plog('info', `[launch] ${label}: freeing held dev port :${server.port} before launch`);
        await killPortProcess(server.port);
      }
      // A Tauri app.exe binds the CDP debug port; free it too so the new app can bind
      // it (else the live preview's CDP attach fails against a stale instance).
      // With allocator-issued ports this is a no-op belt-and-braces check.
      if (cdpPort) {
        const cdpProbe = await probePort(cdpPort);
        if (cdpProbe?.data?.listening) {
          plog('info', `[launch] ${label}: freeing held CDP port :${cdpPort} before launch`);
          await killPortProcess(cdpPort);
        }
      }
      // Let the OS release the sockets before the new process tries to bind.
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      plog('warn', `[launch] ${label}: pre-launch port free failed (continuing): ${e?.message || e}`);
    }

    // Spawn PTY
    let shellId;
    try {
      const result = await terminalSpawn({ cwd: projectPath, outputChannel: channelLabel, env: spawnEnv });
      if (!result?.success || !result?.data?.id) {
        updateState(projectPath, { status: 'stopped', stopReason: 'failed to spawn a terminal', startedAt: null });
        plog('error', `[launch] ${label}: terminalSpawn failed: ${result?.error || 'no shell id returned'}`);
        toastStore.addToast({
          message: 'Failed to spawn terminal for dev server',
          severity: 'error',
          key: `dev-server-${projectPath}`,
        });
        return { status: 'refused', reason: 'Failed to spawn a terminal for the dev server' };
      }

      shellId = result.data.id;
      updateState(projectPath, { shellId });

      // Add terminal tab
      const tabTitle = server.framework
        ? `${server.framework} :${server.port}`
        : `Localhost :${server.port}`;

      terminalTabsStore.addDevServerTab({
        shellId,
        title: tabTitle,
        projectPath,
        framework: server.framework,
        port: server.port,
      });

      // Build start command with correct package manager prefix
      let startCommand = server.startCommand || 'npm run dev';
      if (packageManager && packageManager !== 'npm' && startCommand.startsWith('npm run ')) {
        const script = startCommand.replace('npm run ', '');
        startCommand = `${packageManager} run ${script}`;
      }

      // Chain setup commands with && (fail-fast among setup steps),
      // but use ; before the start command so it always attempts to start
      // even if pip install partially fails (e.g. one package can't build).
      // terminalInput() is fire-and-forget — cannot send commands one at a time.
      if (server.setupCommands && server.setupCommands.length > 0) {
        const setupChain = server.setupCommands.join(' && ');
        const fullCommand = setupChain + '; ' + startCommand;
        await terminalInput(shellId, fullCommand + '\n');
      } else {
        await terminalInput(shellId, startCommand + '\n');
      }
      plog('info', `[launch] ${label}: PTY ${shellId} spawned, command sent: ${startCommand}`);
    } catch (err) {
      plog('error', `[launch] ${label}: start failed: ${err?.message || err}`);
      updateState(projectPath, { status: 'stopped', stopReason: String(err?.message || err), startedAt: null });
      toastStore.addToast({
        message: `Dev server start failed: ${err.message || err}`,
        severity: 'error',
        key: `dev-server-${projectPath}`,
      });
      return { status: 'refused', reason: `Dev server start failed: ${err?.message || err}` };
    }

    // Watch readiness in the BACKGROUND — the caller (and the sandbox_start
    // ACK) gets the honest 'spawned' outcome now; status only becomes
    // 'running' when the app is actually up.
    const hasSetup = !!(server.setupCommands && server.setupCommands.length > 0);
    const watcher = server.native
      // Native app: readiness = an OS window appears in the launch's process
      // tree (there's no port to poll). Mirror it via WGC by HWND.
      ? watchNativeStartup(projectPath, server, shellId)
      : watchStartup(projectPath, server, cdpPort, hasSetup, shellId);
    watcher.catch((err) => {
      plog('error', `[launch] ${label}: startup watcher crashed: ${err?.message || err}`);
    });

    return {
      status: 'spawned',
      devPort: server.port,
      cdpPort,
      framework: server.framework || null,
    };
  }

  /**
   * Background readiness watcher for a just-spawned dev server.
   *
   * Initial poll (30s, or 5min with setup commands) → if not ready, KEEP
   * WATCHING for up to EXTENDED_POLL_TIMEOUT more instead of lying with
   * status='running' (the old behavior, which minted phantom entries): a cold
   * `tauri dev` build legitimately takes minutes. The port binding promotes to
   * 'running'; giving up demotes to stopped(reason).
   */
  async function watchStartup(projectPath, server, cdpPort, hasSetup, shellId) {
    const label = `${server.framework || 'server'} :${server.port}`;
    // Still the launch this watcher belongs to? ('idle' = backgrounded by a
    // project switch mid-build — keep watching, matching the old promotion.)
    const stillMine = () => {
      const s = servers.get(projectPath);
      return !!s && s.shellId === shellId && (s.status === 'starting' || s.status === 'idle');
    };

    // Readiness signal: for a Tauri app, the CDP debug port — it binds only
    // when the actual app WINDOW exists, which is the meaningful "ready" for a
    // live preview. A frontend dev port (e.g. yaak's Vite on :1420) binds early
    // while the Rust app still compiles for minutes, so it would promote to
    // 'running' long before there's anything to mirror. Fall back to the dev
    // port for plain web projects (no CDP).
    const readinessPort = cdpPort || server.port;
    const initialTimeout = hasSetup ? SETUP_POLL_TIMEOUT : POLL_TIMEOUT;
    let ready = false;
    if (!readinessPort) {
      // Nothing pollable at all — trust the spawn and let the health sweep own it.
      markRunning(projectPath, server, cdpPort);
      return;
    }
    try {
      ready = await pollPort(readinessPort, projectPath, initialTimeout);
    } catch (err) {
      if (err?.message === 'cancelled') return; // stopped/crashed during poll
      throw err;
    }

    if (!ready) {
      if (!stillMine()) return;
      plog('warn', `[launch] ${label}: port :${readinessPort} not listening after ${initialTimeout / 1000}s — still watching, status stays 'starting'`);
      toastStore.addToast({
        message: hasSetup
          ? 'Setup may still be running — check terminal'
          : `Still building/starting ${server.framework || 'app'}${server.port ? ` :${server.port}` : ''} — check the terminal if this persists`,
        severity: 'warning',
        key: `dev-server-${projectPath}`,
      });
      try {
        ready = await pollPort(readinessPort, projectPath, EXTENDED_POLL_TIMEOUT);
      } catch (err) {
        if (err?.message === 'cancelled') return;
        throw err;
      }
      if (!ready) {
        if (!stillMine()) return;
        plog('error', `[launch] ${label}: giving up — port :${readinessPort} never listened within ${(initialTimeout + EXTENDED_POLL_TIMEOUT) / 60000}min`);
        demoteToStopped(projectPath, `nothing listened on :${readinessPort} — check the terminal for build errors`);
        return;
      }
    }

    if (!stillMine()) return; // superseded by a stop/relaunch mid-poll
    markRunning(projectPath, server, cdpPort);
  }

  /**
   * Background readiness watcher for a NATIVE desktop app (egui/iced, no CDP).
   * There's no port to poll: `cargo run` compiles first, then a window appears
   * owned by the launch's process tree. Poll for that window; when it shows,
   * open the App Preview mirroring it (WGC by HWND). Same honest timeouts as the
   * web watcher — a cold cargo build can take minutes.
   */
  async function watchNativeStartup(projectPath, server, shellId) {
    const label = `${server.framework || 'app'} (native)`;
    const stillMine = () => {
      const s = servers.get(projectPath);
      return !!s && s.shellId === shellId && (s.status === 'starting' || s.status === 'idle');
    };
    const deadline = Date.now() + POLL_TIMEOUT + EXTENDED_POLL_TIMEOUT;
    let warned = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!stillMine()) return;
      let hwnd = null;
      try {
        const res = await findNativeWindow(shellId);
        hwnd = res?.data?.hwnd ?? null;
      } catch {
        // backend not ready / transient — keep polling
      }
      if (hwnd) {
        if (!stillMine()) return;
        updateState(projectPath, {
          status: 'running',
          lastActiveTime: Date.now(),
          startedAt: (() => {
            const prev = servers.get(projectPath);
            if (prev?.startedAt) {
              const dur = Date.now() - prev.startedAt;
              if (dur > 1000 && dur < 30 * 60 * 1000) {
                try { localStorage.setItem(`vm:lastLaunchMs:${projectPath}`, String(dur)); } catch { /* ignore */ }
              }
            }
            return null;
          })(),
          stopReason: null,
          healthMisses: 0,
        });
        plog('info', `[launch] ${label}: window ${hwnd} appeared — mirroring via WGC`);
        sandboxPreviewStore.openNative(hwnd);
        toastStore.addToast({
          message: `${server.framework || 'App'} is up`,
          severity: 'success',
          key: `dev-server-${projectPath}`,
        });
        ensureHealthSweep();
        return;
      }
      const elapsed = Date.now() - (servers.get(projectPath)?.startedAt || Date.now());
      if (!warned && elapsed > POLL_TIMEOUT) {
        warned = true;
        plog('warn', `[launch] ${label}: no window yet after ${POLL_TIMEOUT / 1000}s — still building/watching`);
        toastStore.addToast({
          message: `Still building ${server.framework || 'the app'} — check the terminal if this persists`,
          severity: 'warning',
          key: `dev-server-${projectPath}`,
        });
      }
    }
    if (!stillMine()) return;
    plog('error', `[launch] ${label}: gave up — no app window appeared`);
    demoteToStopped(projectPath, 'no app window appeared — check the terminal for build errors');
  }

  /**
   * Promote a server to 'running' (its port is verified listening) and wire
   * up the preview: CDP port registration for Tauri apps, Lens navigation for
   * web projects. Starts the runtime health sweep.
   */
  function markRunning(projectPath, server, cdpPort) {
    // Remember how long THIS launch took so the App Preview panel can render a
    // real 0→100% bar next time (estimate against the last success). Capture
    // before clearing startedAt below. Ignore absurd values (clock jumps).
    const prev = servers.get(projectPath);
    if (prev?.startedAt) {
      const dur = Date.now() - prev.startedAt;
      if (dur > 1000 && dur < 30 * 60 * 1000) {
        try { localStorage.setItem(`vm:lastLaunchMs:${projectPath}`, String(dur)); } catch { /* private mode / quota */ }
      }
    }
    updateState(projectPath, {
      status: 'running',
      lastActiveTime: Date.now(),
      startedAt: null,
      stopReason: null,
      healthMisses: 0,
    });
    plog('info', `[launch] ${server.framework || 'server'}${server.port ? ` :${server.port}` : ''}: READY${cdpPort ? ` — CDP :${cdpPort} live` : ' — port listening'}`);
    if (cdpPort) {
      // Tauri app: the App Preview (the real app via CDP) is the canonical
      // view. Don't also load the web frontend into the Lens browser — it's
      // the same app shown stretched, which is confusing. Register the CDP
      // port so the App Preview + the AI's sandbox_* tools use it.
      sandboxSetActivePort(cdpPort).catch((err) =>
        plog('warn', `[launch] sandboxSetActivePort(${cdpPort}) failed: ${err?.message || err}`)
      );
    } else {
      // Web project: show it in the Lens browser as before.
      lensNavigate(server.url).catch(() => {});
    }
    toastStore.addToast({
      message: server.port
        ? `${server.framework || 'Server'} ready on :${server.port}`
        : `${server.framework || 'App'} is up`,
      severity: 'success',
      key: `dev-server-${projectPath}`,
    });
    ensureHealthSweep();
  }

  /**
   * Mark a server stopped WITHOUT killing its PTY (the shell may hold the
   * build errors the user needs to read). Clears the preview wiring so
   * nothing keeps pointing at a dead port. The reason lands in
   * `state.stopReason` + the preview channel — never a silent phantom.
   */
  function demoteToStopped(projectPath, reason, opts = {}) {
    const state = servers.get(projectPath);
    if (!state) return;
    cancelPoll(projectPath);
    cancelIdleTimer(projectPath);
    if (state.cdpPort) {
      sandboxClearActivePort().catch(() => {});
    }
    updateState(projectPath, {
      status: 'stopped',
      stopReason: reason,
      cdpPort: null,
      startedAt: null,
      healthMisses: 0,
    });
    plog('warn', `[lifecycle] ${state.framework || 'server'} :${state.port} (${projectPath}) marked stopped: ${reason}`);
    if (!opts.quiet) {
      // A launch that died before ever opening a preview session would
      // otherwise strand the App panel on "Starting App Preview…" forever —
      // resolve it with the reason. (No-op when a live session is active; the
      // stream's own disconnect detection owns that state. Quiet demotions are
      // internal housekeeping right before a relaunch — no error flash.)
      sandboxPreviewStore.launchFailed(
        `${state.framework || 'Dev server'} on :${state.port} stopped — ${reason}`
      );
      toastStore.addToast({
        message: `${state.framework || 'Dev server'} on :${state.port} stopped — ${reason}`,
        severity: 'warning',
        key: `dev-server-${projectPath}`,
      });
    }
  }

  /** @type {ReturnType<typeof setInterval>|null} */
  let healthSweepTimer = null;

  /**
   * Periodic truth check: every server claiming 'running'/'idle' must have a
   * listening port; HEALTH_CHECK_MISSES consecutive failed probes demote it to
   * stopped(reason). A PTY can outlive the dev server inside it (the app exits,
   * the shell prompt remains — no shell-exit event ever fires), so shell
   * liveness alone cannot be trusted. Kills phantom 'running' entries.
   */
  function ensureHealthSweep() {
    if (healthSweepTimer != null) return;
    healthSweepTimer = setInterval(sweepHealth, HEALTH_CHECK_INTERVAL);
  }

  async function sweepHealth() {
    let anyAlive = false;
    for (const [pp, state] of servers) {
      if (state.status !== 'running' && state.status !== 'idle') continue;
      anyAlive = true;
      // Static-frontend Tauri apps (no dev port): the CDP port is the pulse.
      const pulsePort = state.port || state.cdpPort;
      if (!pulsePort) continue;
      let listening = false;
      try {
        const probe = await probePort(pulsePort);
        listening = !!probe?.data?.listening;
      } catch {
        // Probe failure counts as a miss.
      }
      const s = servers.get(pp);
      if (!s || (s.status !== 'running' && s.status !== 'idle')) continue; // changed mid-probe
      if (listening) {
        if (s.healthMisses) updateState(pp, { healthMisses: 0 });
      } else {
        const misses = (s.healthMisses || 0) + 1;
        updateState(pp, { healthMisses: misses });
        plog('warn', `[health] ${s.framework || 'server'} :${pulsePort}: port probe miss ${misses}/${HEALTH_CHECK_MISSES}`);
        if (misses >= HEALTH_CHECK_MISSES) {
          demoteToStopped(pp, `port :${pulsePort} stopped listening (the process likely exited)`);
        }
      }
    }
    // Nothing left to watch — stop sweeping until the next markRunning().
    if (!anyAlive && healthSweepTimer != null) {
      clearInterval(healthSweepTimer);
      healthSweepTimer = null;
    }
  }

  /**
   * Stop a dev server for a project.
   * @param {string} projectPath
   */
  async function stopServer(projectPath) {
    const state = servers.get(projectPath);
    if (!state || !state.shellId) return;

    const framework = state.framework;
    const port = state.port;

    // Drop the sandbox preview's active CDP port if this server owned one.
    if (state.cdpPort) {
      sandboxClearActivePort().catch(() => {});
    }

    cancelPoll(projectPath);
    cancelIdleTimer(projectPath);

    plog('info', `[lifecycle] stopping ${framework || 'server'} :${port} (${projectPath})`);

    // Capture shellId, then clear it BEFORE killing so handleShellExit
    // won't match this shell and wrongly report it as a crash.
    const shellId = state.shellId;
    updateState(projectPath, {
      status: 'stopped',
      shellId: null,
      cdpPort: null,
      startedAt: null,
      stopReason: 'stopped',
      healthMisses: 0,
    });

    try {
      await terminalKill(shellId);
    } catch (err) {
      console.warn('[dev-server-manager] Kill failed:', err);
    }

    terminalTabsStore.markExited(shellId);

    // Unregister project output channel
    if (state.outputChannel) {
      try {
        await outputStore.unregisterProjectChannel(state.outputChannel);
      } catch (err) {
        console.warn('[dev-server-manager] Failed to unregister output channel:', err);
      }
    }
    updateState(projectPath, { outputChannel: null });

    toastStore.addToast({
      message: `Stopped ${framework || 'dev server'}${port ? ` on :${port}` : ''}`,
      severity: 'info',
      key: `dev-server-${projectPath}`,
    });
  }

  /**
   * Stop a dev server by its shell ID. Used when killing a terminal instance
   * that happens to be a dev server (sidebar kill button, context menu).
   * @param {string} shellId
   */
  async function stopServerByShellId(shellId) {
    for (const [pp, state] of servers) {
      if (state.shellId === shellId) {
        await stopServer(pp);
        return;
      }
    }
  }

  /**
   * Check if a shell ID belongs to a running dev server.
   * @param {string} shellId
   * @returns {boolean}
   */
  function isDevServerShell(shellId) {
    for (const [, state] of servers) {
      if (state.shellId === shellId && (state.status === 'running' || state.status === 'starting' || state.status === 'idle')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Stop an externally-running server by killing its port process.
   * Used for servers we didn't start (no shellId), detected as already running.
   * @param {number} port
   */
  async function stopExternalServer(port) {
    let killed = false;
    try {
      /** @type {{ success?: boolean, data?: { killed?: boolean }, error?: string }} */
      const result = await killPortProcess(port);
      if (result?.success && result?.data?.killed) {
        killed = true;
        toastStore.addToast({
          message: `Stopped process on :${port}`,
          severity: 'success',
        });
      } else {
        toastStore.addToast({
          message: result?.error || `Failed to stop process on :${port}`,
          severity: 'error',
        });
      }
    } catch (err) {
      console.error('[dev-server-manager] Kill port failed:', err);
      toastStore.addToast({
        message: `Failed to stop process on :${port}: ${err.message || err}`,
        severity: 'error',
      });
    }
    // Only update the server list if we actually killed the process
    if (killed) {
      const current = lensStore.devServers;
      const updated = current.map(s =>
        s.port === port ? { ...s, running: false } : s
      );
      lensStore.setDevServers(updated);
    }
  }

  /**
   * Restart a dev server -- stops then starts again.
   * Requires the original server config to be stored or passed again.
   * @param {string} projectPath
   */
  async function restartServer(projectPath) {
    const state = servers.get(projectPath);
    if (!state) return;

    // Preserve server info for restart
    const serverConfig = {
      url: state.url,
      port: state.port,
      framework: state.framework,
      startCommand: state.startCommand,
    };

    await stopServer(projectPath);

    // Reset crash state so manual restart works even after crash loop
    updateState(projectPath, { crashCount: 0, crashLoopDetected: false, lastCrashTime: null });

    // Small delay to let the process fully exit
    await new Promise(resolve => setTimeout(resolve, 500));

    await startServer(serverConfig, projectPath);
  }

  /**
   * Get current server status for a project.
   * @param {string} projectPath
   * @returns {ServerState|null}
   */
  function getServerStatus(projectPath) {
    return servers.get(projectPath) || null;
  }

  /**
   * Handle crash detection when a dev-server shell exits.
   * @param {string} shellId
   * @param {number} [exitCode]
   */
  function handleShellExit(shellId, exitCode) {
    // Find which project this shell belongs to
    let crashedProject = null;
    for (const [pp, state] of servers) {
      if (state.shellId === shellId) {
        crashedProject = pp;
        break;
      }
    }
    if (!crashedProject) return;

    const state = servers.get(crashedProject);
    if (!state) return;

    // Drop the sandbox preview's active CDP port if this crashed server owned one.
    if (state.cdpPort) {
      sandboxClearActivePort().catch(() => {});
    }

    const wasRunning = state.status === 'running' || state.status === 'starting';

    // Update crash tracking
    const now = Date.now();
    let crashCount = state.crashCount;
    const lastCrashTime = state.lastCrashTime;

    // Reset crash count if outside the window
    if (lastCrashTime && (now - lastCrashTime) > CRASH_LOOP_WINDOW) {
      crashCount = 0;
    }

    if (wasRunning || (exitCode !== undefined && exitCode !== 0)) {
      crashCount++;
    }

    const crashLoopDetected = crashCount >= CRASH_LOOP_COUNT;

    // An idle (or otherwise not running/starting) server exiting cleanly is a
    // normal shutdown, not a crash — recording it as 'crashed' fed false
    // diagnostics (crashedServers list, crash toasts on the next launch).
    const cleanExit = exitCode === undefined || exitCode === 0;
    const isCrash = wasRunning || !cleanExit;
    plog(
      isCrash ? 'error' : 'info',
      `[lifecycle] ${state.framework || 'server'} :${state.port} (${crashedProject}) shell exited ` +
        `(code=${exitCode ?? 'unknown'}, was=${state.status}) — marking ${isCrash ? 'crashed' : 'stopped'}` +
        (crashLoopDetected ? ' [CRASH LOOP — auto-restart disabled]' : '')
    );
    updateState(crashedProject, {
      status: isCrash ? 'crashed' : 'stopped',
      shellId: null,
      crashCount,
      // Only stamp crash time on an actual crash — a clean stop must not
      // contribute to the crash-loop window.
      lastCrashTime: isCrash ? now : lastCrashTime,
      crashLoopDetected,
      startedAt: null,
      stopReason: isCrash
        ? `shell exited unexpectedly (code=${exitCode ?? 'unknown'})`
        : 'shell exited cleanly',
      healthMisses: 0,
    });

    cancelPoll(crashedProject);
    cancelIdleTimer(crashedProject);

    if (crashLoopDetected) {
      toastStore.addToast({
        message: `${state.framework || 'Server'} crash loop detected (${CRASH_LOOP_COUNT} crashes in ${CRASH_LOOP_WINDOW / 60000}min) — auto-restart disabled`,
        severity: 'error',
        duration: 0,
        key: `dev-server-crash-${crashedProject}`,
      });
    } else if (wasRunning) {
      toastStore.addToast({
        message: `${state.framework || 'Dev server'} crashed unexpectedly`,
        severity: 'warning',
        key: `dev-server-crash-${crashedProject}`,
      });
    }
  }

  /**
   * Handle project switch -- start idle timer for old project, cancel timer for new project.
   * @param {string|null} oldPath
   * @param {string|null} newPath
   */
  function handleProjectSwitch(oldPath, newPath) {
    // Cancel idle timer for the project we're switching TO
    if (newPath) {
      cancelIdleTimer(newPath);
      const newState = servers.get(newPath);
      if (newState && newState.status === 'idle') {
        updateState(newPath, { status: 'running', lastActiveTime: Date.now() });
      }
    }

    // Start idle timer for the project we're leaving
    if (oldPath) {
      const oldState = servers.get(oldPath);
      if (oldState && (oldState.status === 'running' || oldState.status === 'starting')) {
        updateState(oldPath, { status: 'idle' });
        const timer = setTimeout(() => {
          idleTimers.delete(oldPath);
          stopServer(oldPath);
        }, IDLE_TIMEOUT);
        idleTimers.set(oldPath, timer);
      }
    }
  }

  return {
    get servers() { return servers; },

    get runningCount() {
      return countRunning();
    },

    get crashedServers() {
      const crashed = [];
      for (const [pp, state] of servers) {
        if (state.status === 'crashed') {
          crashed.push({ projectPath: pp, ...state });
        }
      }
      return crashed;
    },

    startServer,
    stopServer,
    stopServerByShellId,
    stopExternalServer,
    restartServer,
    getServerStatus,
    isDevServerShell,
    handleShellExit,
    handleProjectSwitch,

    // Exposed for testing
    POLL_INTERVAL,
    POLL_TIMEOUT,
    SETUP_POLL_TIMEOUT,
    IDLE_TIMEOUT,
    MAX_CONCURRENT,
    CRASH_LOOP_COUNT,
    CRASH_LOOP_WINDOW,
    EXTENDED_POLL_TIMEOUT,
    HEALTH_CHECK_INTERVAL,
    HEALTH_CHECK_MISSES,
    STALE_STARTING_MS,
  };
}

export const devServerManager = createDevServerManager();

export {
  POLL_INTERVAL,
  POLL_TIMEOUT,
  SETUP_POLL_TIMEOUT,
  IDLE_TIMEOUT,
  MAX_CONCURRENT,
  CRASH_LOOP_COUNT,
  CRASH_LOOP_WINDOW,
  EXTENDED_POLL_TIMEOUT,
  HEALTH_CHECK_INTERVAL,
  HEALTH_CHECK_MISSES,
  STALE_STARTING_MS,
};
