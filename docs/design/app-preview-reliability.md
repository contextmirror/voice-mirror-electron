# App Preview reliability — findings & plan

*2026-07-03. Produced from a live diagnostic session: full code audit + four
instrumented launch attempts against a real project (Yap). This is the working
brief for the reliability effort. Start at "The plan" if you know the background.*

## The goal (Nathan's words)

> "A preview window for **all apps** to be built inside of, where you can have a
> look at them as well as I can see it. … We need our app preview to reliably
> work every time. **Or at least if it doesn't, it's a UX that explains why.**"

Three asks: **(1) stability first, (2) failure UX that explains why,
(3) logs from every app into the Output panel.**

## Design north star: capability tiers, not pass/fail

"All apps" can't mean one mechanism that works or dies. The launcher's job is
to get the app running, then **classify it onto the highest tier it supports**
— and every downgrade states its reason in the preview panel:

| Tier | Apps | Preview shows | AI can |
|------|------|---------------|--------|
| 1 — full loop | CDP apps (Tauri/Electron/Chromium) | live mirror | see DOM + drive via CDP |
| 2 — see + drive | any visible Windows app | WGC mirror | drive via UIA |
| 3 — see only | windows UIA can't drive | WGC mirror | screenshots only |
| 4 — headless | servers, consoles, hidden-window apps | liveness + port + **streaming logs** | read logs/ports |

Nothing ever says "failed to start preview." The floor is Tier 4 with a reason:
*"No window appeared after Ns — showing logs. (This app may be single-instance
and already running, or it may not open a window.)"*

## How it works today (audit summary)

Full audit with file:line refs lives in the session that produced this doc;
key structure:

- `sandbox_start` (MCP) → named pipe → `pipe_server.rs:620-778` → emits Tauri
  event `sandbox-start-request` → **frontend** `LensWorkspace.svelte:310-355`
  → `dev-server-manager.svelte.js:196-400` spawns a PTY (`npm run tauri dev`),
  injects CDP port via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, polls the dev
  port ≤30 s, then registers the CDP port with `services/sandbox.rs`.
- CDP port is a **formula**: `9223 + (dev_port % 1000)`, duplicated in JS
  (`dev-server-manager.svelte.js:257`) and Rust (`pipe_server.rs:679`).
- CDP target ↔ OS window correlation is **by window size** (35% tolerance,
  `sandbox.rs:1038-1065`) because Tauri window titles/URLs collide.
- The visual mirror is **Windows.Graphics.Capture** → JPEG → MJPEG server on
  ports 9876-9886 (`window_stream.rs`), with **CDP screencast** fallback when
  WGC yields no frame within 1.5 s (`sandbox_stream.rs:88-131`).
- Focus-follow: `SetWinEventHook` (foreground/destroy/hide) + 2.5 s backstop,
  freshest-intent-wins arbitration (`window_follow.rs`).
- Non-Tauri web projects **never get an App Preview by design** — they route
  to the Lens browser (`dev-server-manager.svelte.js:371-374`).

## Live failure evidence (4 attempts, one afternoon)

| # | What happened | Root cause |
|---|---------------|------------|
| 1 | App built & launched, then **silently exited in <4 s**; PTY dropped to a shell prompt; preview had nothing to capture; no error anywhere | Target app (Yap) was single-instance and the installed copy was running. **Fixed in Yap** (`nayballs/Yap@e0012a9`): single-instance is now release-only. VM itself has the same plugin ⇒ same fix needed here (Phase 0) |
| 2 | `sandbox_start` said "Kicked off Tauri" — **nothing spawned at all**. Zero processes, zero log lines | Stale dev-server entry: attempt 1's server stayed `status=running` forever; `startServer` no-ops; tool reports optimistically regardless |
| 3 | (after manually clearing the phantom via status bar) App launched, CDP fine, AI could snapshot/drive all 4 windows — but the **visual preview was a 330×48 black sliver** | All of the app's windows are hidden at startup; the mirror captured the hidden transparent overlay; no "app is running but has no visible window" UX |
| 4 | Spawned nothing again | Phantom "running" entry re-created by the previous kill; stop-then-start race |

Supporting evidence:
- The word "sandbox" appears **0 times** in 1,089 app-log entries — the launch
  path logs nothing, so failures cannot be diagnosed after the fact.
- Project log channels map **stderr → ERROR** wholesale, so Vite's normal
  startup banner is logged as an error and real errors drown
  ("`VITE v6.4.3 ready in 594 ms`" shows as ERROR in the Yap channel).

## The 15 failure modes (ranked, from the code audit)

1. **Cold `tauri dev` builds outrun every timeout** (start poll 10 s, dev-port
   poll 30 s, window search 20 s vs minutes of compiling). CDP port never gets
   registered when polls expire → auto-open never fires.
2. **Launch = an event tossed at the frontend.** If the Lens workspace isn't
   mounted or the project root is null, the request is dropped with only a
   `console.warn`; the MCP tool still reports "launching".
3. **CDP port formula collides** for dev ports 1000 apart (3000/4000, 1420/2420)
   and is duplicated in JS + Rust (drift breaks attach silently).
4. **Non-Tauri web apps get no preview by design** (browser-tab routing) —
   reads as "doesn't work" to users.
5. **Port already held → refusal or `taskkill /F` self-heal** that can kill the
   user's own session (or fail on elevated holders); errors only in terminal.
6. **WGC no-frame → 1.5 s fallback window too short**; CDP screencast renders
   transparent windows black. Idle/occluded/hidden windows → black or frozen.
7. **Size-based CDP↔HWND correlation mis-binds** similar windows / DPI cases.
8. **MJPEG port pool is 11 ports**; exhaustion = log-only death of the preview.
9. **Host-identity exclusion by title substring** can eat legitimate apps.
10. **Stale global registries** (active port/hwnd/refs) survive app restarts →
    ghost targets, "snapshot may be stale".
11. **WinEvent hook fragility**; elevated windows deliver no events at all.
12. **Ambiguous native-window routing** can drive an unrelated window.
13. **Anti-throttle/CDP flags depend on env inheritance** through
    npm→cargo→app.exe; any strip = no CDP, no diagnosis.
14. IPv4/IPv6 discovery latency stacks against the tight startup polls.
15. **Preview auto-open is one-shot per port** (`lastAutoPort`) and suppressed
    after manual hide — same-port relaunches don't reopen.

## The plan

### Phase 0 — bootstrap (required before anything is testable)
- [ ] **VM single-instance → release-only** (mirror Yap fix
      `nayballs/Yap@e0012a9` in `lib.rs`); duplicate release launch should
      show/focus the main window. Without this, a dev VM cannot run beside the
      installed VM that the developer is talking through.

### Phase 1 — stability (the "it just doesn't work" killers)
- [ ] **Dev-server lifecycle owns truth**: `status=running` must be tied to a
      live PTY *and* a listening port, re-verified on every poll; process exit
      or port loss ⇒ `status=stopped(reason)`. Kills the phantom-entry bug
      (evidence #2/#4, mode 1/15).
- [ ] **`sandbox_start` stops lying**: it returns only what actually happened
      (spawned / already-running-verified / refused(reason) / dropped(reason)).
      The frontend hop must ACK back through the pipe; no ACK in N s ⇒ report
      the drop honestly (mode 2).
- [ ] **Log the whole launch lifecycle** to the `preview` channel: every
      decision, spawn, poll result, downgrade, teardown — with the failing
      value in the message.
- [ ] **stderr ≠ ERROR** in project channels: classify by content
      (error/warning regexes), default stderr→info. Fixes cry-wolf logs.
- [ ] **Real port allocation**: spawner binds port 0 (or scans) and *returns*
      the CDP port; formula removed from both sides (mode 3).

### Phase 2 — the honest preview panel
- [ ] Preview panel states: `building (cargo output tail)` → `starting` →
      `tier N preview` / `downgraded: <reason> + suggested action`. The Yap
      case renders as: "App is running — 4 windows, all hidden. Showing logs.
      [Show a window] [Attach anyway]".
- [ ] **Tier 4 = logs + liveness always available** (Nathan's ask #3): every
      launched app streams its output into the panel even with no window.
- [ ] Adaptive timeouts: while cargo/npm output is flowing, the build isn't
      "stuck" — timers pause during active compile output (mode 1).

### Phase 3 — redesign (single-owner lifecycle)
- [ ] One backend-owned state machine per launched app: spawn → readiness
      (port + process + optional window) → classify tier → mirror/attach →
      teardown. Frontend renders state; it never owns transitions.
- [ ] **Window identity by launch cookie** (env-stamped marker or PID tree)
      instead of size correlation (modes 7/9).
- [ ] Registries keyed by launch-id, cleared on process exit (mode 10).
- [ ] Widen MJPEG port pool / lazy-allocate (mode 8).
- [ ] Revisit non-Tauri apps: web projects deserve a Tier-1-like preview via
      an embedded webview of localhost (how VS Code/JetBrains sidestep window
      mirroring entirely) — see prior art below.

### Prior art (external research — key findings)

**The five techniques to bet on:**

1. **Job Objects for process-tree truth.** The PID we spawn (`npm`/`cmd`) is
   never the PID that owns the socket or the window. `CreateJobObject` +
   assign at spawn + completion port gives a live PID set for the whole
   descendant tree (`JOB_OBJECT_MSG_NEW_PROCESS`/`EXIT_PROCESS`). Everything
   downstream keys off "PID ∈ job": port ownership, window ownership,
   process-exit teardown. This one primitive kills failure modes 1/2/7/10.
2. **Layered readiness, Playwright-webServer-style.** Port discovery via
   `GetExtendedTcpTable` filtered to job PIDs (crates: `listeners`,
   `netstat2`) → then HTTP-probe the URL; ready on 2xx/3xx *or* 400-403
   (auth-gated apps are still up). Probe BOTH `127.0.0.1` and `::1`.
   Stdout regexes (Vite/Next banners) change across versions — use output
   only as a *hint* for which URL to probe (VS Code treats stdout as hint,
   socket table as truth).
3. **Window detection = WinEvent hook + reconciliation** (komorebi's
   pattern): `SetWinEventHook(EVENT_OBJECT_SHOW, idProcess ∈ job)` for
   latency, a periodic `EnumWindows` sweep for correctness (events get
   missed), filter cloaked windows via `DWMWA_CLOAKED` (fresh windows are
   cloaked before shown), "main window" = visible+unowned+titled. Treat the
   WGC first frame as "visually ready"; for web content CDP
   `Page.lifecycleEvent(firstContentfulPaint)` is precise.
4. **Keep WGC for mirroring — it's the right choice** (occlusion-proof,
   Win10 1903+; `windows-capture` crate is production-proven in screenpipe;
   OBS defaults to WGC too). Minimized windows stop producing frames — detect
   and say so. Optional zero-copy *display* path: DWM thumbnails (what
   OnTopReplica uses) — smooth but no pixel access for the AI, and its
   click-forwarding history proves interaction-via-mirror is a dead end.
   **Never `SetParent`** cross-process embedding (multrin's issue tracker is
   the cautionary tale: focus loss, DPI breakage, apps crashing).
5. **Arm CDP at launch; never attach post-hoc.** WebView2/Tauri:
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=N` before
   environment creation — with the caveat that WebView2 instances sharing a
   user-data folder share ONE browser process and the *first* creator's args
   win (a second app on the same UDF silently gets no port — likely another
   live failure source). Electron/Chromium: `--remote-debugging-port=0` +
   read the `DevToolsActivePort` file rather than scraping stderr; poll
   `/json/version` chrome-launcher-style (~500ms × 50). Pass
   `--force-renderer-accessibility` so the UIA fallback actually has a tree.

**For plain web projects** (failure mode 4): don't mirror a window at all —
do what VS Code Simple Browser / JetBrains / Cursor do: an embedded browser
surface pointed at the detected localhost URL, with CDP attached for the AI.
VM already has the Lens browser; "App Preview" for web apps should be Lens
rendering the dev URL *inside the preview panel* with the same tier chrome.

**Readiness-model reference:** process-compose implements k8s-style
`readiness_probe` (http_get/exec, intervals, failure thresholds, startup vs
readiness distinction) in a dev-process manager — the config shape to copy
for per-framework probe overrides.

## Working on this

- Dev instance: `npm run dev` in `E:\Projects\Voice Mirror` (after Phase 0
  lands, it coexists with the installed app; before that, close the installed
  app first).
- Guinea pig: `E:\Projects\Yap` — a real Tauri app whose failure modes are
  known; its side has been fixed (dev builds coexist + show Settings in dev),
  so remaining failures are VM's.
- Local `cargo test` note: use `CARGO_TARGET_DIR=target-audit` if the dev app
  is running (sidecar file lock), and see issue #45 for the lib-harness
  loader bug (MCP-binary tests DO run).
