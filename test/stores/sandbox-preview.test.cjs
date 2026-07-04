/**
 * sandbox-preview.test.cjs -- Source-inspection tests for sandbox-preview.svelte.js
 *
 * Validates the live-preview store that drives the SandboxPreview panel: exports,
 * factory, $state shape, open/close lifecycle, and that it backs onto the
 * sandbox_stream MJPEG screencast via the api wrappers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'sandbox-preview.svelte.js'),
  'utf-8'
);

describe('sandbox-preview: exports', () => {
  it('exports sandboxPreviewStore', () => {
    assert.ok(src.includes('export const sandboxPreviewStore'), 'Should export sandboxPreviewStore');
  });

  it('creates the store via a factory', () => {
    assert.ok(src.includes('function createSandboxPreviewStore()'), 'Should define the factory');
  });
});

describe('sandbox-preview: integration', () => {
  it('starts/stops the screencast via the api wrappers', () => {
    assert.ok(src.includes('sandboxStreamStart'), 'Should call sandboxStreamStart');
    assert.ok(src.includes('sandboxStreamStop'), 'Should call sandboxStreamStop');
  });

  it('lists app windows for the switcher / auto-follow', () => {
    assert.ok(src.includes('sandboxListWindows'), 'Should call sandboxListWindows');
  });

  it('unwraps the IpcResponse to get the stream url', () => {
    assert.ok(src.includes('unwrapResult'), 'Should unwrap the response');
    assert.ok(src.includes('data?.url') || src.includes('data.url'), 'Should read the stream url');
  });
});

describe('sandbox-preview: state', () => {
  for (const field of ['active', 'visible', 'maximized', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`uses $state for ${field}`, () => {
      assert.ok(
        new RegExp(`let\\s+${field}\\s*=\\s*\\$state\\(`).test(src),
        `Should use $state for ${field}`
      );
    });
  }

  for (const getter of ['active', 'visible', 'maximized', 'cdpPort', 'streamUrl', 'loading', 'error']) {
    it(`has getter ${getter}`, () => {
      assert.ok(src.includes(`get ${getter}()`), `Should expose getter ${getter}`);
    });
  }
});

describe('sandbox-preview: maximize layout', () => {
  it('defaults maximized to true so the preview opens big, not crammed', () => {
    assert.ok(
      /let\s+maximized\s*=\s*\$state\(true\)/.test(src),
      'maximized should default to true'
    );
  });

  it('exposes a toggleMaximize() method', () => {
    assert.ok(/toggleMaximize\(\)\s*\{/.test(src), 'Should expose toggleMaximize()');
    const block = src.split('toggleMaximize()')[1]?.split('},')[0] || '';
    assert.ok(block.includes('maximized = !maximized'), 'toggleMaximize should flip maximized');
  });

  it('exposes a setMaximized(value) setter', () => {
    assert.ok(/setMaximized\(value\)\s*\{/.test(src), 'Should expose setMaximized(value)');
  });

  it('opening a new session resets to maximized', () => {
    const block = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(block.includes('maximized = true'), 'open() should set maximized = true for a new session');
  });
});

describe('sandbox-preview: lifecycle', () => {
  it('has open/show/hide/close methods', () => {
    assert.ok(/async open\(port/.test(src), 'Should have async open(port, ...)');
    assert.ok(/show\(\)/.test(src), 'Should have show()');
    assert.ok(/hide\(\)/.test(src), 'Should have hide()');
    assert.ok(/close\(\)\s*\{/.test(src), 'Should have close()');
  });

  it('open is idempotent per port', () => {
    const block = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(
      block.includes('cdpPort === port'),
      'open should no-op when already active on the same port'
    );
  });

  it('hide keeps the session (does not stop the screencast)', () => {
    const block = src.split('hide()')[1]?.split('switchTo(')[0] || '';
    assert.ok(!block.includes('sandboxStreamStop'), 'hide should NOT stop the screencast');
    assert.ok(block.includes('visible = false'), 'hide should just clear visibility');
  });

  it('close stops the screencast for the current port', () => {
    // Inspect the close() METHOD body (the last `close()` — syncAuto also calls
    // `this.close()`), which must stop the screencast.
    const block = src.slice(src.lastIndexOf('close()'));
    assert.ok(block.includes('sandboxStreamStop'), 'close should stop the screencast');
  });
});

describe('sandbox-preview: auto-open guard (remount-proof)', () => {
  it('keeps the auto-open dedupe guard in the store (not the component)', () => {
    assert.ok(src.includes('lastAutoPort'), 'Should track lastAutoPort in the store');
    assert.ok(/syncAuto\(port\)/.test(src), 'Should expose syncAuto(port)');
  });

  it('respects an explicit user-hide', () => {
    assert.ok(src.includes('userHidden'), 'Should track userHidden');
  });

  it('does not tear down an attached external app on auto-sync', () => {
    assert.ok(src.includes('attached'), 'Should track attached sessions');
  });
});

describe('sandbox-preview: closed-window recovery', () => {
  it('tracks a noWindow empty-state flag in $state with a getter', () => {
    assert.ok(
      /let\s+noWindow\s*=\s*\$state\(false\)/.test(src),
      'Should hold noWindow in $state(false)'
    );
    assert.ok(src.includes('get noWindow()'), 'Should expose a noWindow getter');
  });

  it('prefers re-targeting to a VISIBLE window when the followed one closes', () => {
    // The retarget block filters the live window list by the backend `visible`
    // flag and starts the stream on a surviving window.
    assert.ok(src.includes('w.visible'), 'Should filter windows by the visible flag');
    assert.ok(
      /startStream\(visible\[0\]\.hwnd\)/.test(src),
      'Should re-target to the first visible window'
    );
  });

  it('sets noWindow (not an endless spinner) when nothing is mirrorable', () => {
    assert.ok(/noWindow\s*=\s*true/.test(src), 'Should set noWindow = true when no visible window');
  });

  it('clears noWindow when a window is shown / on open / on show', () => {
    assert.ok(/noWindow\s*=\s*false/.test(src), 'Should reset noWindow = false somewhere');
    const openBlock = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(openBlock.includes('noWindow = false'), 'open() should clear noWindow');
  });

  it('exposes an async openApp() that re-launches via sandbox-start-request', () => {
    assert.ok(/async openApp\(\)/.test(src), 'Should expose async openApp()');
    assert.ok(
      src.includes("emit('sandbox-start-request'") || src.includes('emit("sandbox-start-request"'),
      'openApp should emit sandbox-start-request'
    );
    assert.ok(
      src.includes("from '@tauri-apps/api/event'"),
      'Should import emit from @tauri-apps/api/event'
    );
  });

  it('openApp re-attaches to a live visible window instead of relaunching when one exists', () => {
    const block = src.split('async openApp()')[1]?.split('},')[0] || '';
    // When the app is still alive (a visible window is available), re-mirror it
    // rather than no-op relaunching the already-up dev server.
    assert.ok(
      block.includes('windows.filter') && block.includes('w.visible'),
      'openApp should check for live visible windows'
    );
    assert.ok(block.includes('startStream('), 'openApp should re-mirror a live window via startStream');
    assert.ok(
      block.includes('noWindow = false'),
      'openApp should clear noWindow when re-attaching to a live window'
    );
  });
});

describe('sandbox-preview: confirm-before-start', () => {
  it('tracks a confirmStart flag in $state with a getter', () => {
    assert.ok(/let\s+confirmStart\s*=\s*\$state\(false\)/.test(src), 'Should hold confirmStart in $state(false)');
    assert.ok(src.includes('get confirmStart()'), 'Should expose a confirmStart getter');
  });

  it('promptStart auto-starts when the project remembers a preference, else prompts', () => {
    assert.ok(/async promptStart\(\)/.test(src), 'Should expose async promptStart()');
    const block = src.split('async promptStart()')[1]?.split('},')[0] || '';
    assert.ok(block.includes('autoStartPreview'), 'Should read the per-project autoStartPreview preference');
    assert.ok(block.includes('this.requestStart()'), 'Should requestStart immediately when remembered');
    assert.ok(block.includes('confirmStart = true'), 'Should show the prompt when not remembered');
  });

  it('confirmStartNow persists the preference when "always" is chosen, then starts', () => {
    const block = src.split('async confirmStartNow(')[1]?.split('},')[0] || '';
    assert.ok(
      block.includes("updateActiveField('autoStartPreview', true)"),
      'Should persist autoStartPreview=true via projectStore when always'
    );
    assert.ok(block.includes('this.requestStart()'), 'Should proceed to requestStart');
  });

  it('cancelStart dismisses the prompt without launching', () => {
    const block = src.split('cancelStart()')[1]?.split('},')[0] || '';
    assert.ok(block.includes('confirmStart = false'), 'Should clear confirmStart');
    assert.ok(block.includes('visible = false'), 'Should hide the panel');
    assert.ok(!block.includes('sandbox-start-request'), 'Should NOT emit a start request');
  });

  it('reads the per-project preference from projectStore', () => {
    assert.ok(src.includes("from './project.svelte.js'"), 'Should import projectStore');
  });

  it('a live session clears any pending start prompt', () => {
    const openBlock = src.split('async open(port')[1]?.split('syncAuto(')[0] || '';
    assert.ok(openBlock.includes('confirmStart = false'), 'open() should clear confirmStart');
  });
});

describe('sandbox-preview: multi-window', () => {
  it('tracks the window list and current window', () => {
    assert.ok(/let\s+windows\s*=\s*\$state\(/.test(src), 'Should hold a windows list in $state');
    assert.ok(/let\s+currentHwnd\s*=\s*\$state\(/.test(src), 'Should track currentHwnd in $state');
    assert.ok(src.includes('get windows()'), 'Should expose a windows getter');
    assert.ok(src.includes('get currentHwnd()'), 'Should expose a currentHwnd getter');
  });

  it('has a switchTo(hwnd) method', () => {
    assert.ok(/switchTo\(hwnd\)/.test(src), 'Should expose switchTo(hwnd)');
  });

  it('follows the backend event-driven window-follow (sandbox-follow-target)', () => {
    // The backend `window_follow` service (OS focus hook + AI-vs-user arbiter)
    // emits `sandbox-follow-target`; the store obeys it by re-targeting the stream.
    assert.ok(
      src.includes("listen('sandbox-follow-target'") ||
        src.includes('listen("sandbox-follow-target"'),
      'Should listen for the sandbox-follow-target event',
    );
    assert.ok(src.includes('startStream('), 'Should re-target the stream to the followed window');
    // The follow listener is torn down on close (unlisten handle).
    assert.ok(src.includes('followUnlisten'), 'Should hold an unlisten handle for the follow event');
    // Manual switcher choice pins the view so it stops auto-following.
    assert.ok(src.includes('userPinned'), 'Switcher choice should pin via userPinned');
  });

  it('keeps a slow reconciliation poll for the switcher list + disconnect detection', () => {
    assert.ok(src.includes('setInterval'), 'Should keep a reconciliation interval');
    assert.ok(src.includes('refreshWindows'), 'Should keep a refreshWindows loop');
    assert.ok(src.includes('listFailCount'), 'Should keep dead-port disconnect detection');
    // The per-tick active-hwnd follow query was removed (event-driven now).
    assert.ok(!src.includes('sandboxActiveHwnd'), 'Should NOT poll sandbox_active_hwnd per tick');
  });
});

// -- Launch-failure surfacing (Phase 2: the panel must never spin forever) --

describe('sandbox-preview.svelte.js -- launchFailed', () => {
  const wsSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'lens', 'LensWorkspace.svelte'),
    'utf-8'
  );
  const dsmSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'dev-server-manager.svelte.js'),
    'utf-8'
  );

  it('exposes launchFailed(reason) that resolves the Starting state', () => {
    assert.ok(src.includes('launchFailed(reason)'), 'Store should expose launchFailed');
    const block = src.split('launchFailed(reason)')[1]?.slice(0, 400) || '';
    assert.ok(block.includes('if (active) return'), 'Must not clobber a live session');
    assert.ok(block.includes('loading = false'), 'Must leave the loading state');
    assert.ok(block.includes('error ='), 'Must surface the reason via the error state');
  });

  it('requestStart clears a previous launch failure (retry works)', () => {
    const block = src.split('async requestStart()')[1]?.slice(0, 400) || '';
    assert.ok(block.includes("error = ''"), 'Retry must clear the prior error');
  });

  it('LensWorkspace feeds every refusal path into launchFailed', () => {
    const occurrences = (wsSrc.match(/sandboxPreviewStore\.launchFailed\(/g) || []).length;
    assert.ok(
      occurrences >= 4,
      `no-path / refused-outcome / no-server / catch must all resolve the panel (found ${occurrences})`
    );
  });

  it('a non-quiet demotion resolves the panel too (port never bound)', () => {
    const block = dsmSrc.split('function demoteToStopped')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('sandboxPreviewStore.launchFailed('), 'Demotion must resolve the panel');
    assert.ok(
      block.indexOf('sandboxPreviewStore.launchFailed(') > block.indexOf('if (!opts.quiet)'),
      'Quiet (pre-relaunch housekeeping) demotions must NOT flash an error'
    );
  });
});

// -- Build-output tail in the Starting state (Phase 2: the wait narrates itself) --

describe('SandboxPreview.svelte -- starting-state build tail', () => {
  const cmpSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'lens', 'preview', 'SandboxPreview.svelte'),
    'utf-8'
  );

  it('derives the in-flight launch from the dev-server manager', () => {
    assert.ok(cmpSrc.includes('devServerManager'), 'component should read the manager');
    assert.ok(cmpSrc.includes("s.status === 'starting'"), 'should find the starting entry');
  });

  it('tails the launch project channel into the panel', () => {
    assert.ok(cmpSrc.includes('outputChannel'), 'tail source is the launch output channel');
    assert.ok(cmpSrc.includes('projectEntries'), 'reads outputStore.projectEntries');
    assert.ok(cmpSrc.includes('build-tail'), 'renders the tail block');
  });

  it('does not depend on the Output tab having been opened', () => {
    // The project-channel stream flows only once the output store listens;
    // the preview must arm that itself (startListening is idempotent).
    assert.ok(cmpSrc.includes('outputStore.startListening()'), 'preview must arm the stream');
  });

  it('shows elapsed seconds with a cold-build hint', () => {
    assert.ok(cmpSrc.includes('startElapsed'), 'elapsed ticker');
    assert.ok(cmpSrc.includes('native build can take minutes'), 'sets expectation on long builds');
  });
});

// -- Determinate launch progress (Nathan's ask: a real 0→100% bar) --

describe('SandboxPreview.svelte -- launch progress bar', () => {
  const cmpSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'lens', 'preview', 'SandboxPreview.svelte'),
    'utf-8'
  );
  const dsmSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'dev-server-manager.svelte.js'),
    'utf-8'
  );

  it('the startingServer derivation returns a fresh snapshot, not the live ref', () => {
    // The manager mutates Map entries in place; returning the same object
    // reference made later field updates (outputChannel) invisible to
    // dependents. A shallow copy per recompute keeps them tracking.
    const block = cmpSrc.split('const startingServer = $derived.by(')[1]?.split('});')[0] || '';
    assert.ok(block.includes('{ ...best'), 'must snapshot the entry, not return best directly');
  });

  it('estimates against the last-launch duration, default baseline on the first', () => {
    assert.ok(cmpSrc.includes('vm:lastLaunchMs:'), 'reads the persisted baseline');
    assert.ok(cmpSrc.includes('const progressPct'), 'has a progress derivation');
    // Always determinate now — a default baseline keeps the FIRST launch moving.
    assert.ok(cmpSrc.includes('DEFAULT_BASELINE_MS'), 'first launch uses a default estimate');
    assert.ok(cmpSrc.includes('progress-fill'), 'renders a determinate fill');
    assert.ok(cmpSrc.includes('role="progressbar"'), 'exposes an a11y progressbar');
  });

  it('flashes 100% on the first frame before hiding (visible completion)', () => {
    assert.ok(cmpSrc.includes('justCompleted'), 'has a completion-flash flag');
    assert.ok(cmpSrc.includes('if (justCompleted) return 100'), 'flash forces 100%');
    // showProgress must keep the bar up during the flash even though hasFrame.
    assert.ok(cmpSrc.includes('!hasFrame || justCompleted'), 'bar stays visible for the 100% flash');
  });

  it('the manager persists successful-launch duration on markRunning', () => {
    const block = dsmSrc.split('function markRunning')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('vm:lastLaunchMs:'), 'markRunning must persist the duration');
    assert.ok(block.includes('prev?.startedAt'), 'measured from startedAt');
  });
});

// -- Auto-recovery when the app restarts (tauri dev relaunch → new window) --

describe('sandbox-preview.svelte.js -- restart recovery', () => {
  it('re-targets a fresh window after having given up (noWindow)', () => {
    // A fresh `tauri dev` build restarts the app once (gen/ files) — the first
    // mirrored window closes, CDP drops then returns with a new window. The
    // poll must auto-recover instead of stranding "The app window was closed."
    const block = src.split('async function refreshWindows')[1]?.split('function startPolling')[0] || '';
    assert.ok(block.includes('if (noWindow) {'), 'recovery branch keyed on the given-up state');
    assert.ok(block.includes('noWindow = false'), 'recovery clears the empty state');
    assert.ok(/if \(noWindow\) \{[\s\S]*startStream\(/.test(block), 'recovery re-targets a live window');
  });
});

// -- "Hanging or failing?" — surface build errors during the starting state --

describe('SandboxPreview.svelte -- failing-launch hint', () => {
  const cmpSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'lens', 'preview', 'SandboxPreview.svelte'),
    'utf-8'
  );
  it('flags a launch that logs ERRORs after a grace period', () => {
    assert.ok(cmpSrc.includes('buildHasErrors'), 'derives whether the build is erroring');
    assert.ok(cmpSrc.includes("e.level === 'ERROR'"), 'keys off ERROR-classified output');
    assert.ok(/\(startElapsed \?\? 0\) > 20/.test(cmpSrc), 'only after a grace period (transient early errors)');
    assert.ok(cmpSrc.includes('build-warn'), 'renders the honest warning');
  });
});
