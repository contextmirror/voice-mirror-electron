/**
 * preview-launch-robustness.test.cjs -- Source-inspection tests for the three
 * "any app" launch reliability fixes surfaced by excalidraw (a yarn-monorepo
 * vite app that would not run in App Preview):
 *
 *  1. BROWSER=none on EVERY launch — excalidraw's vite.config has
 *     `server.open: true`, so vite popped the system browser (Brave) and the
 *     app escaped App Preview. Vite + create-react-app both honor BROWSER=none.
 *  2. Corepack bridge — excalidraw pins `packageManager: yarn@1.22.22` and its
 *     start script is `yarn && vite`, but yarn isn't globally installed. The
 *     npm-fallback can't save a script that itself calls yarn; corepack shims
 *     (prepended to the PTY PATH) make both the outer and inner calls resolve.
 *  3. Real-port-from-stdout — the config port is a STATIC guess and can be
 *     wrong (`port: Number(env || 3000)` → :3000, not the :5173 we parse). The
 *     server prints its real URL, so readiness + mirror retarget to it.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf-8');

const dsm = read('src', 'lib', 'stores', 'dev-server-manager.svelte.js');
const api = read('src', 'lib', 'api.js');
const util = read('src-tauri', 'src', 'services', 'dev_server', 'util.rs');
const sandboxCmds = read('src-tauri', 'src', 'commands', 'sandbox.rs');
const libRs = read('src-tauri', 'src', 'lib.rs');
const terminalRs = read('src-tauri', 'src', 'terminal', 'mod.rs');

describe('launch fix 1 -- suppress the dev server browser auto-open', () => {
  it('sets BROWSER=none in the spawn env', () => {
    assert.ok(dsm.includes("BROWSER: 'none'"), 'spawnEnv must carry BROWSER=none');
  });
  it('applies it to EVERY launch, not just the CDP/Tauri branch', () => {
    // BROWSER lives on the base object; the WebView2 args are spread in only
    // when cdpPort is set — so a plain web app still gets BROWSER=none.
    const idx = dsm.indexOf("BROWSER: 'none'");
    const cdpIdx = dsm.indexOf('...(cdpPort');
    assert.ok(idx !== -1 && cdpIdx !== -1 && idx < cdpIdx, 'BROWSER must precede the cdpPort spread');
  });
});

describe('launch fix 2 -- corepack bridge for pinned yarn/pnpm', () => {
  it('exposes ensure_corepack_shims from util.rs', () => {
    assert.ok(util.includes('pub fn ensure_corepack_shims'), 'helper must exist');
    assert.ok(util.includes('pub fn intended_package_manager'), 'reads the pinned manager');
    assert.ok(util.includes('packageManager'), 'honors the corepack packageManager field');
    assert.ok(util.includes('--install-directory'), 'generates shims into a VM dir, not the Node install');
    // The dev server spawns in a MEMBER dir (excalidraw-app); the manager is
    // pinned at the monorepo ROOT — so resolution must walk up parent dirs.
    assert.ok(util.includes('dir = d.parent()'), 'intended_package_manager walks up to the workspace root');
  });
  it('is registered as a Tauri command', () => {
    assert.ok(sandboxCmds.includes('pub fn ensure_corepack_shims'), 'command wrapper');
    assert.ok(libRs.includes('sandbox_cmds::ensure_corepack_shims'), 'registered in invoke handler');
  });
  it('is bound in api.js and called before spawn', () => {
    assert.ok(api.includes('export async function ensureCorepackShims('), 'api binding');
    assert.ok(dsm.includes('ensureCorepackShims('), 'launch calls it');
    assert.ok(dsm.includes('VM_PREPEND_PATH'), 'passes the shim dir as a PATH-prepend directive');
    assert.ok(dsm.includes('COREPACK_ENABLE_DOWNLOAD_PROMPT'), 'disables the interactive download prompt (PTY hang guard)');
  });
  it('the PTY prepends (not replaces) PATH for VM_PREPEND_PATH', () => {
    assert.ok(terminalRs.includes('VM_PREPEND_PATH'), 'spawn honors the directive');
    assert.ok(terminalRs.includes('std::env::var("PATH")'), 'prepends to the live PATH');
  });
});

describe('launch fix 3 -- learn the real port from the dev server stdout', () => {
  it('scans the output channel for the announced localhost URL', () => {
    assert.ok(dsm.includes('function scanOutputForPort'), 'sniffer helper');
    assert.ok(dsm.includes('ANSI_RE'), 'strips ANSI so bolded port digits are reachable');
  });
  it('retargets readiness + mirror to the announced port', () => {
    assert.ok(dsm.includes('let targetPort = cdpPort || server.port'), 'CDP-first, else the (correctable) dev port');
    assert.ok(dsm.includes('pollPort(() => targetPort'), 'polls via a getter so the correction takes effect mid-poll');
    assert.ok(dsm.includes('scanOutputForPort(channel)'), 'the retarget loop reads the channel');
  });
});
