const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/dev-server-manager.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

// -- Exports --

describe('dev-server-manager.svelte.js -- exports', () => {
  it('exports devServerManager', () => {
    assert.ok(src.includes('export const devServerManager'), 'Should export devServerManager');
  });

  it('exports POLL_INTERVAL constant', () => {
    assert.ok(src.includes('POLL_INTERVAL'), 'Should export POLL_INTERVAL');
  });

  it('exports POLL_TIMEOUT constant', () => {
    assert.ok(src.includes('POLL_TIMEOUT'), 'Should export POLL_TIMEOUT');
  });

  it('exports IDLE_TIMEOUT constant', () => {
    assert.ok(src.includes('IDLE_TIMEOUT'), 'Should export IDLE_TIMEOUT');
  });

  it('exports MAX_CONCURRENT constant', () => {
    assert.ok(src.includes('MAX_CONCURRENT'), 'Should export MAX_CONCURRENT');
  });

  it('exports CRASH_LOOP_COUNT constant', () => {
    assert.ok(src.includes('CRASH_LOOP_COUNT'), 'Should export CRASH_LOOP_COUNT');
  });

  it('exports CRASH_LOOP_WINDOW constant', () => {
    assert.ok(src.includes('CRASH_LOOP_WINDOW'), 'Should export CRASH_LOOP_WINDOW');
  });
});

// -- Constants values --

describe('dev-server-manager.svelte.js -- constant values', () => {
  it('POLL_INTERVAL is 500ms', () => {
    assert.ok(src.includes('POLL_INTERVAL = 500'), 'POLL_INTERVAL should be 500');
  });

  it('POLL_TIMEOUT is 30000ms', () => {
    assert.ok(src.includes('POLL_TIMEOUT = 30000'), 'POLL_TIMEOUT should be 30000');
  });

  it('IDLE_TIMEOUT is 300000ms (5 minutes)', () => {
    assert.ok(src.includes('IDLE_TIMEOUT = 300000'), 'IDLE_TIMEOUT should be 300000');
  });

  it('MAX_CONCURRENT is 3', () => {
    assert.ok(src.includes('MAX_CONCURRENT = 3'), 'MAX_CONCURRENT should be 3');
  });

  it('CRASH_LOOP_COUNT is 3', () => {
    assert.ok(src.includes('CRASH_LOOP_COUNT = 3'), 'CRASH_LOOP_COUNT should be 3');
  });

  it('CRASH_LOOP_WINDOW is 300000ms (5 minutes)', () => {
    assert.ok(src.includes('CRASH_LOOP_WINDOW = 300000'), 'CRASH_LOOP_WINDOW should be 300000');
  });
});

// -- Imports --

describe('dev-server-manager.svelte.js -- imports', () => {
  it('imports terminalSpawn from api', () => {
    assert.ok(src.includes('terminalSpawn'), 'Should import terminalSpawn');
  });

  it('imports terminalInput from api', () => {
    assert.ok(src.includes('terminalInput'), 'Should import terminalInput');
  });

  it('imports terminalKill from api', () => {
    assert.ok(src.includes('terminalKill'), 'Should import terminalKill');
  });

  it('imports probePort from api', () => {
    assert.ok(src.includes('probePort'), 'Should import probePort');
  });

  it('imports lensNavigate from api', () => {
    assert.ok(src.includes('lensNavigate'), 'Should import lensNavigate');
  });

  it('imports killPortProcess from api', () => {
    assert.ok(src.includes('killPortProcess'), 'Should import killPortProcess');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports lensStore', () => {
    assert.ok(src.includes('lensStore'), 'Should import lensStore');
  });

  it('imports toastStore', () => {
    assert.ok(src.includes('toastStore'), 'Should import toastStore');
  });
});

// -- Reactive state --

describe('dev-server-manager.svelte.js -- reactive state', () => {
  it('uses $state for servers Map', () => {
    assert.ok(src.includes('$state(new Map())'), 'Should use $state(new Map()) for servers');
  });

  it('has servers getter', () => {
    assert.ok(src.includes('get servers()'), 'Should have servers getter');
  });

  it('has runningCount getter', () => {
    assert.ok(src.includes('get runningCount()'), 'Should have runningCount getter');
  });

  it('has crashedServers getter', () => {
    assert.ok(src.includes('get crashedServers()'), 'Should have crashedServers getter');
  });
});

// -- Server state fields --

describe('dev-server-manager.svelte.js -- server state fields', () => {
  it('tracks status field', () => {
    assert.ok(src.includes("status: 'stopped'"), 'Should have status field with stopped default');
  });

  it('tracks shellId field', () => {
    assert.ok(src.includes('shellId: null'), 'Should have shellId field');
  });

  it('tracks port field', () => {
    assert.ok(src.includes('port: null'), 'Should have port field');
  });

  it('tracks framework field', () => {
    assert.ok(src.includes('framework: null'), 'Should have framework field');
  });

  it('tracks url field', () => {
    assert.ok(src.includes('url: null'), 'Should have url field');
  });

  it('tracks crashCount field', () => {
    assert.ok(src.includes('crashCount: 0'), 'Should have crashCount field');
  });

  it('tracks lastCrashTime field', () => {
    assert.ok(src.includes('lastCrashTime: null'), 'Should have lastCrashTime field');
  });

  it('tracks lastActiveTime field', () => {
    assert.ok(src.includes('lastActiveTime: Date.now()'), 'Should have lastActiveTime field');
  });

  it('tracks crashLoopDetected field', () => {
    assert.ok(src.includes('crashLoopDetected: false'), 'Should have crashLoopDetected field');
  });
});

// -- Methods --

describe('dev-server-manager.svelte.js -- methods', () => {
  it('has startServer method', () => {
    assert.ok(src.includes('startServer'), 'Should have startServer');
    assert.ok(src.includes('async function startServer('), 'startServer should be async');
  });

  it('has stopServer method', () => {
    assert.ok(src.includes('stopServer'), 'Should have stopServer');
    assert.ok(src.includes('async function stopServer('), 'stopServer should be async');
  });

  it('has restartServer method', () => {
    assert.ok(src.includes('restartServer'), 'Should have restartServer');
    assert.ok(src.includes('async function restartServer('), 'restartServer should be async');
  });

  it('has getServerStatus method', () => {
    assert.ok(src.includes('getServerStatus'), 'Should have getServerStatus');
  });

  it('has handleShellExit method', () => {
    assert.ok(src.includes('handleShellExit'), 'Should have handleShellExit');
  });

  it('has handleProjectSwitch method', () => {
    assert.ok(src.includes('handleProjectSwitch'), 'Should have handleProjectSwitch');
  });

  it('has stopExternalServer method', () => {
    assert.ok(src.includes('stopExternalServer'), 'Should have stopExternalServer');
    assert.ok(src.includes('async function stopExternalServer('), 'stopExternalServer should be async');
  });

  it('stopExternalServer calls killPortProcess', () => {
    const block = src.split('async function stopExternalServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('killPortProcess(port)'), 'Should call killPortProcess with port');
  });

  it('stopExternalServer updates devServers list after killing', () => {
    const block = src.split('async function stopExternalServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('lensStore.setDevServers'), 'Should update lensStore devServers');
  });

  it('exposes stopExternalServer on the returned object', () => {
    assert.ok(src.includes('stopExternalServer,'), 'Should export stopExternalServer in return object');
  });
});

// -- Start server behavior --

describe('dev-server-manager.svelte.js -- startServer behavior', () => {
  it('calls terminalSpawn with project cwd', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('terminalSpawn({ cwd: projectPath'), 'Should spawn terminal with projectPath cwd');
  });

  it('calls terminalInput with start command', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('terminalInput(shellId,'), 'Should send start command via terminalInput');
  });

  it('adds dev server tab via terminalTabsStore', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('terminalTabsStore.addDevServerTab'), 'Should add dev server tab');
  });

  it('polls port with probePort', () => {
    assert.ok(src.includes('probePort('), 'Should call probePort for polling');
  });

  it('navigates lens on ready', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('lensNavigate(server.url)'), 'Should navigate lens to server URL on ready');
  });

  it('shows success toast on ready', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes("severity: 'success'"), 'Should show success toast on ready');
  });

  it('warns honestly on initial timeout instead of claiming running', () => {
    // Old behavior set status='running' on timeout (minting phantom entries);
    // the watcher now says it's still building and keeps status='starting'.
    const block = src.split('async function watchStartup')[1] || '';
    assert.ok(block.includes('Still building/starting'), 'Should show the still-watching warning toast');
    assert.ok(!/(status:\s*'running'[\s\S]{0,200}not ready)/.test(block), 'Must not mark running on timeout');
  });

  it('handles package manager prefix replacement', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('packageManager') && block.includes("startsWith('npm run ')"), 'Should replace npm with detected package manager');
  });
});

// -- Stop server behavior --

describe('dev-server-manager.svelte.js -- stopServer behavior', () => {
  it('clears shellId before killing to prevent false crash detection', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    const clearIdx = block.indexOf("shellId: null");
    const killIdx = block.indexOf('terminalKill(');
    assert.ok(clearIdx > 0 && killIdx > 0, 'Should have both state clear and terminalKill');
    assert.ok(clearIdx < killIdx, 'Should clear shellId BEFORE calling terminalKill');
  });

  it('calls terminalKill with captured shellId', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('terminalKill(shellId)'), 'Should call terminalKill with captured shellId');
  });

  it('marks tab as exited', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('terminalTabsStore.markExited'), 'Should mark tab as exited');
  });

  it('cancels poll timer', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('cancelPoll('), 'Should cancel port polling');
  });

  it('cancels idle timer', () => {
    const block = src.split('async function stopServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('cancelIdleTimer('), 'Should cancel idle timer');
  });
});

// -- Crash detection --

describe('dev-server-manager.svelte.js -- crash detection', () => {
  it('handleShellExit finds project by shellId', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('state.shellId === shellId'), 'Should find project by shellId');
  });

  it('increments crashCount on crash', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('crashCount++'), 'Should increment crash count');
  });

  it('sets status to crashed (unless a non-running server exited cleanly)', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(
      block.includes('const isCrash = wasRunning || !cleanExit'),
      'Should classify the exit (crash vs clean stop of a non-running server)'
    );
    assert.ok(
      block.includes("status: isCrash ? 'crashed' : 'stopped'"),
      'Should set crashed for real crashes, stopped for a clean exit of an idle server'
    );
    assert.ok(
      block.includes('lastCrashTime: isCrash ? now : lastCrashTime'),
      'A clean stop must not stamp lastCrashTime (would feed the crash-loop window)'
    );
  });

  it('detects crash loops after CRASH_LOOP_COUNT', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('crashCount >= CRASH_LOOP_COUNT'), 'Should detect crash loop');
  });

  it('resets crash count outside window', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('CRASH_LOOP_WINDOW'), 'Should check crash window');
  });

  it('shows crash loop toast with duration 0 (persistent)', () => {
    const block = src.split('function handleShellExit')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('duration: 0'), 'Should show persistent toast for crash loop');
  });
});

// -- Idle timeout + LRU --

describe('dev-server-manager.svelte.js -- idle timeout and LRU eviction', () => {
  it('handleProjectSwitch starts idle timer for old project', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes('IDLE_TIMEOUT'), 'Should use IDLE_TIMEOUT for idle timer');
  });

  it('handleProjectSwitch cancels idle timer for new project', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes('cancelIdleTimer(newPath)'), 'Should cancel idle timer for new project');
  });

  it('sets status to idle on project switch away', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes("status: 'idle'"), 'Should set status to idle');
  });

  it('restores idle server to running on switch back', () => {
    const block = src.split('function handleProjectSwitch')[1] || '';
    assert.ok(block.includes("status: 'running'"), 'Should restore idle server to running');
  });

  it('has findLRUIdle function for LRU eviction', () => {
    assert.ok(src.includes('findLRUIdle'), 'Should have findLRUIdle function');
  });

  it('findLRUIdle picks server with oldest lastActiveTime', () => {
    const block = src.split('function findLRUIdle')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('lastActiveTime'), 'Should compare lastActiveTime');
  });

  it('evicts LRU when at MAX_CONCURRENT', () => {
    assert.ok(src.includes('countRunning() >= MAX_CONCURRENT'), 'Should check MAX_CONCURRENT before evicting');
  });

  it('has countRunning function', () => {
    assert.ok(src.includes('function countRunning'), 'Should have countRunning function');
  });

  it('countRunning includes running, idle AND starting statuses', () => {
    // startServer marks the new server 'starting' BEFORE calling evictIfNeeded,
    // so 'starting' must count toward MAX_CONCURRENT or concurrent launches
    // blow past the cap.
    const block = src.split('function countRunning')[1]?.split('\n  function')[0] || '';
    assert.ok(
      block.includes("'running'") && block.includes("'idle'") && block.includes("'starting'"),
      'Should count running, idle and starting servers'
    );
  });
});

// -- Port polling --

describe('dev-server-manager.svelte.js -- port polling', () => {
  it('has pollPort function', () => {
    assert.ok(src.includes('function pollPort('), 'Should have pollPort function');
  });

  it('uses setInterval for polling', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('setInterval('), 'Should use setInterval for polling');
  });

  it('polls at POLL_INTERVAL rate', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('POLL_INTERVAL'), 'Should use POLL_INTERVAL');
  });

  it('times out at POLL_TIMEOUT', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('POLL_TIMEOUT'), 'Should use POLL_TIMEOUT');
  });

  it('resolves true when port is listening', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve(true)'), 'Should resolve true when listening');
  });

  it('resolves false on timeout', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve(false)'), 'Should resolve false on timeout');
  });
});

// -- Crash loop protection in startServer --

describe('dev-server-manager.svelte.js -- crash loop protection', () => {
  it('startServer checks crashLoopDetected before starting', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashLoopDetected'), 'Should check crashLoopDetected');
  });

  it('returns early with toast when crash loop detected', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crash loop') || block.includes('Crash loop'), 'Should show crash loop message');
  });
});

// -- Tab title formatting --

describe('dev-server-manager.svelte.js -- tab title formatting', () => {
  it('uses framework name in tab title when available', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('server.framework'), 'Should use framework in tab title');
  });

  it('falls back to Localhost for unknown framework', () => {
    const block = src.split('async function startServer')[1] || '';
    assert.ok(block.includes('Localhost'), 'Should fall back to Localhost');
  });
});

// -- W1: restartServer resets crash state --

describe('dev-server-manager.svelte.js -- restartServer crash state reset', () => {
  it('resets crashCount to 0 before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashCount: 0'), 'Should reset crashCount to 0');
  });

  it('resets crashLoopDetected to false before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('crashLoopDetected: false'), 'Should reset crashLoopDetected');
  });

  it('resets lastCrashTime to null before restarting', () => {
    const block = src.split('async function restartServer')[1]?.split('async function')[0] || '';
    assert.ok(block.includes('lastCrashTime: null'), 'Should reset lastCrashTime');
  });
});

// -- W2: pollPort cancellation --

describe('dev-server-manager.svelte.js -- pollPort cancellation', () => {
  it('pollPort promise has reject callback', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('resolve, reject'), 'pollPort should use resolve and reject');
  });

  it('cancelPoll triggers reject with cancelled error', () => {
    const block = src.split('function cancelPoll')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes("reject(new Error('cancelled'))"), 'cancelPoll should reject with cancelled error');
  });

  it('pollTimers stores interval and reject function', () => {
    const block = src.split('function pollPort')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('{ interval, reject }'), 'Should store both interval and reject in pollTimers');
  });

  it('cancelPoll clears interval from poll object', () => {
    const block = src.split('function cancelPoll')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('poll.interval') || block.includes('clearInterval(poll.interval)'), 'Should clear interval from poll object');
  });

  it('watchStartup catches cancelled pollPort rejection', () => {
    // Readiness polling lives in the background watcher now, not startServer.
    const block = src.split('async function watchStartup')[1]?.split('\n  async function')[0] || '';
    assert.ok(block.includes("err?.message === 'cancelled'"), 'Should catch cancelled poll rejection');
  });
});

// -- C3: startServer race condition fix --

describe('dev-server-manager.svelte.js -- startServer race condition fix', () => {
  it('sets status to starting before evictIfNeeded', () => {
    const block = src.split('async function startServer')[1]?.split('async function')[0] || '';
    const startingIdx = block.indexOf("status: 'starting'");
    const evictIdx = block.indexOf('await evictIfNeeded()');
    assert.ok(startingIdx > -1, 'Should set status to starting');
    assert.ok(evictIdx > -1, 'Should call evictIfNeeded');
    assert.ok(startingIdx < evictIdx, 'Should set starting BEFORE evictIfNeeded');
  });
});

// -- force-restart guard (don't churn an in-flight launch) --

describe('dev-server-manager.svelte.js -- force-restart guard', () => {
  it('coalesces into a FRESH starting entry instead of killing it', () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    // A relaunch click mid-launch must let the in-flight start finish: a fresh
    // 'starting' entry returns 'already-starting' instead of stopServer().
    assert.ok(
      block.includes("status: 'already-starting'"),
      'a fresh in-flight launch should be coalesced, not churned'
    );
  });

  it('force CAN tear down a STALE starting entry (un-wedges the stop-start race)', () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    assert.ok(
      block.includes('STALE_STARTING_MS'),
      "force + 'starting' older than STALE_STARTING_MS must be relaunchable"
    );
  });

  it('still force-restarts a running server', () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    assert.ok(block.includes('await stopServer(projectPath)'), 'force on running should stop then restart');
  });

  it("re-verifies a tracked 'running' port before trusting it", () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    // The phantom-entry bug: status='running' forever while nothing listened,
    // so every launch silently no-oped. The guard must probe before no-oping.
    assert.ok(
      block.includes('probePort(state.port ?? server.port)'),
      "must probe the tracked port before honoring status='running'"
    );
    assert.ok(
      block.includes('demoteToStopped('),
      'a dead tracked port must demote the stale entry and relaunch'
    );
  });
});

// -- startCommand preservation --

describe('dev-server-manager.svelte.js -- startCommand preservation', () => {
  it('ServerState includes startCommand field in default', () => {
    assert.ok(src.includes('startCommand: null'), 'getOrCreateState should initialize startCommand: null');
  });

  it('startServer stores startCommand in state from camelCase field', () => {
    assert.ok(
      src.includes('startCommand: server.startCommand'),
      'startServer should store startCommand from server (camelCase from Rust serde)'
    );
  });

  it('restartServer includes startCommand in serverConfig', () => {
    assert.ok(
      src.includes('startCommand: state.startCommand'),
      'restartServer should include startCommand from state'
    );
  });
});

describe('dev-server-manager.svelte.js -- setupCommands chaining', () => {
  it('checks for setupCommands before sending start command', () => {
    assert.ok(
      src.includes('setupCommands') && src.includes('server.setupCommands'),
      'Should check server.setupCommands'
    );
  });

  it('chains setup commands with && for shell sequencing', () => {
    assert.ok(
      src.includes(".join(' && ')"),
      'Should join setupCommands with && for fail-fast shell chaining'
    );
  });

  it('includes startCommand in the chained command', () => {
    // The chain should be: [...setupCommands, startCommand].join(' && ')
    const chainPattern = src.includes('setupCommands') && src.includes('startCommand');
    assert.ok(chainPattern, 'Should chain setupCommands with startCommand');
  });
});

// -- Sandbox CDP (Tauri apps get remote-debugging for the sandbox preview) --

describe('dev-server-manager.svelte.js -- sandbox CDP', () => {
  it('imports the sandbox active-port api wrappers', () => {
    assert.ok(
      src.includes('sandboxSetActivePort') && src.includes('sandboxClearActivePort'),
      'Should import sandboxSetActivePort/sandboxClearActivePort'
    );
  });

  it('only enables CDP for Tauri apps', () => {
    assert.ok(
      src.includes("=== 'tauri'") || src.includes('Tauri'),
      'Should gate CDP injection on the Tauri framework'
    );
  });

  it('injects WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS with --remote-debugging-port', () => {
    assert.ok(
      src.includes('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'),
      'Should set the WebView2 browser-args env var'
    );
    assert.ok(
      src.includes('--remote-debugging-port='),
      'Should pass --remote-debugging-port'
    );
  });

  it('passes the env to terminalSpawn', () => {
    assert.ok(src.includes('env: spawnEnv'), 'Should forward spawnEnv to terminalSpawn');
  });

  it('tracks cdpPort on server state', () => {
    assert.ok(src.includes('cdpPort'), 'ServerState should carry cdpPort');
  });

  it('registers the active sandbox port only once the app is confirmed ready', () => {
    // sandboxSetActivePort must live in markRunning(), which the startup
    // watcher only calls after pollPort confirms the port listens.
    const markBlock = src.split('function markRunning')[1]?.split('\n  function')[0] || '';
    assert.ok(
      markBlock.includes('sandboxSetActivePort'),
      'Should register the active port after readiness (no connection-refused race)'
    );
    const watchBlock = src.split('async function watchStartup')[1]?.split('\n  function markRunning')[0] || '';
    assert.ok(
      watchBlock.includes('markRunning('),
      'watchStartup should promote via markRunning after the port listens'
    );
  });

  it('clears the active sandbox port on stop and on crash', () => {
    // Appears in stopServer and handleShellExit.
    const occurrences = (src.match(/sandboxClearActivePort\(\)/g) || []).length;
    assert.ok(occurrences >= 2, 'Should clear the active port on both stop and crash paths');
  });
});

describe('dev-server-manager.svelte.js -- MAX_CONCURRENT accounting', () => {
  it("countRunning counts 'starting' servers so concurrent launches respect the cap", () => {
    const start = src.indexOf('function countRunning');
    const chunk = src.slice(start, start + 700);
    assert.ok(chunk.includes("state.status === 'starting'"), 'starting servers count toward MAX_CONCURRENT');
  });
});

// -- Phase 1 reliability: lifecycle owns truth (app-preview-reliability.md) --

describe('dev-server-manager.svelte.js -- lifecycle truth (Phase 1)', () => {
  it('startServer returns an honest outcome object', () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    for (const status of ['spawned', 'already-running', 'already-starting', 'refused']) {
      assert.ok(block.includes(`status: '${status}'`), `startServer should be able to return '${status}'`);
    }
  });

  it('has a runtime health sweep that demotes dead servers', () => {
    assert.ok(src.includes('function ensureHealthSweep'), 'Should have ensureHealthSweep');
    const block = src.split('async function sweepHealth')[1] || '';
    assert.ok(block.includes('HEALTH_CHECK_MISSES'), 'Sweep should use the consecutive-miss threshold');
    assert.ok(block.includes('demoteToStopped('), 'Sweep must demote on repeated misses');
  });

  it('demoteToStopped clears the sandbox CDP wiring and records a reason', () => {
    const block = src.split('function demoteToStopped')[1]?.split('\n  function')[0] || '';
    assert.ok(block.includes('sandboxClearActivePort'), 'Demotion must clear the active CDP port');
    assert.ok(block.includes('stopReason: reason'), 'Demotion must record WHY (honest-status UX)');
    assert.ok(!block.includes('terminalKill'), 'Demotion must NOT kill the PTY (it holds build errors)');
  });

  it('keeps watching after the initial poll timeout (extended poll)', () => {
    const block = src.split('async function watchStartup')[1]?.split('\n  function markRunning')[0] || '';
    assert.ok(block.includes('EXTENDED_POLL_TIMEOUT'), 'Cold tauri dev builds outrun 30s — keep watching');
    assert.ok(block.includes('demoteToStopped('), 'Giving up must demote with a reason, not linger');
  });

  it('allocates the CDP port from the backend instead of the old formula', () => {
    const block = src.split('async function startServer')[1]?.split('\n  async function')[0] || '';
    assert.ok(block.includes('findFreeCdpPort()'), 'Should ask the backend allocator for a free port');
  });

  it('logs launch lifecycle to the preview channel', () => {
    assert.ok(src.includes('function plog'), 'Should have the preview-channel log helper');
    assert.ok(src.includes('logPreview('), 'plog should route through the log_preview command');
    const startBlock = src.split('async function startServer')[1] || '';
    assert.ok((startBlock.match(/plog\(/g) || []).length >= 5, 'Launch decisions should be logged');
  });

  it('tracks startedAt / stopReason / healthMisses on server state', () => {
    for (const field of ['startedAt: null', 'stopReason: null', 'healthMisses: 0']) {
      assert.ok(src.includes(field), `getOrCreateState should initialize ${field}`);
    }
  });
});

describe('dev-server-manager.svelte.js -- shell exit of a non-running server', () => {
  it("records a clean exit while not running/starting as 'stopped', not 'crashed'", () => {
    const start = src.indexOf('function handleShellExit');
    const chunk = src.slice(start, start + 2600);
    assert.ok(chunk.includes('exitCode === undefined || exitCode === 0'), 'detects a clean exit');
    assert.ok(
      chunk.includes("status: isCrash ? 'crashed' : 'stopped'"),
      'idle + clean exit must not feed false crash diagnostics'
    );
  });
});
