/**
 * monorepo-detection.test.cjs -- Source-inspection tests for monorepo /
 * workspace-member dev-server detection (the `cwd` plumbing).
 *
 * Live repro that motivated this: opening `tauri-ui` (a Turborepo whose only
 * runnable app is `apps/docs`, a Next.js site) refused with "no dev server
 * detected" because detection only scanned the workspace ROOT. Detection now
 * expands workspace globs and tags member servers with a spawn dir (`cwd`);
 * every startServer call site must spawn in that dir, and the status UIs must
 * key start/stop/status on the same path or stops silently no-op.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf-8');

const workspaceRs = read('src-tauri', 'src', 'services', 'dev_server', 'workspace.rs');
const modRs = read('src-tauri', 'src', 'services', 'dev_server', 'mod.rs');
const lensWorkspace = read('src', 'components', 'lens', 'LensWorkspace.svelte');
const statusDropdown = read('src', 'components', 'lens', 'status', 'StatusDropdown.svelte');
const serversTab = read('src', 'components', 'lens', 'status', 'ServersTab.svelte');
const lensPreview = read('src', 'components', 'lens', 'preview', 'LensPreview.svelte');
const commands = read('src', 'lib', 'commands.svelte.js');

describe('monorepo detection -- Rust side', () => {
  it('DetectedDevServer carries an optional cwd spawn dir', () => {
    assert.ok(modRs.includes('pub cwd: Option<String>'), 'struct needs the cwd field');
    assert.ok(modRs.includes('#[serde(default)]'), 'cwd must default for old callers');
  });

  it('detect_dev_servers runs the workspace member scan after root detection', () => {
    assert.ok(modRs.includes('workspace::detect_workspace_servers'), 'mod.rs must call the scan');
    // Root results first: launch-target preference favors a root app.
    assert.ok(
      modRs.indexOf('python::detect_python_servers') < modRs.indexOf('workspace::detect_workspace_servers'),
      'workspace members come after root-level detection'
    );
  });

  it('workspace scan understands the three member-declaration shapes', () => {
    assert.ok(workspaceRs.includes('"workspaces"') || workspaceRs.includes('get("workspaces")'), 'package.json workspaces');
    assert.ok(workspaceRs.includes('pnpm-workspace.yaml'), 'pnpm workspace manifest');
    assert.ok(workspaceRs.includes('"apps/*"'), 'conventional-dirs fallback');
  });

  it('workspace scan is bounded and skips junk dirs', () => {
    assert.ok(workspaceRs.includes('MAX_MEMBER_DIRS'), 'must cap the crawl');
    assert.ok(workspaceRs.includes('node_modules'), 'must skip node_modules');
  });
});

describe('monorepo detection -- frontend cwd plumbing', () => {
  it('LensWorkspace launches workspace members in their own dir', () => {
    assert.ok(lensWorkspace.includes('target.cwd || path'), 'sandbox-start handler must use cwd');
  });

  it('status UIs key start/stop/status on the same serverKey', () => {
    for (const [name, src] of [['StatusDropdown', statusDropdown], ['ServersTab', serversTab]]) {
      assert.ok(src.includes('function serverKey'), `${name} needs the shared key helper`);
      assert.ok(src.includes('server?.cwd ||'), `${name} key must prefer server.cwd`);
      assert.ok(!src.includes('devServerManager.stopServer(project.path)'), `${name} stop must not hardcode project.path`);
    }
  });

  it('LensPreview auto-start offers spawn in the member dir', () => {
    assert.ok(lensPreview.includes('stoppedServer.cwd || project.path'), 'auto-start must use cwd');
    assert.ok(!lensPreview.includes('startServer(stoppedServer, project.path'), 'no call site may bypass launchPath');
  });

  it('run.start command spawns in the member dir', () => {
    assert.ok(commands.includes('servers[0].cwd || projectPath'), 'command palette start must use cwd');
  });
});

describe('static-frontend Tauri apps (port 0 — no dev server)', () => {
  const dsm = read('src', 'lib', 'stores', 'dev-server-manager.svelte.js');
  const nodeRs = read('src-tauri', 'src', 'services', 'dev_server', 'node.rs');
  const pipeRs = read('src-tauri', 'src', 'ipc', 'pipe_server.rs');

  it('detection reports a devUrl-less tauri.conf.json as port 0', () => {
    assert.ok(nodeRs.includes('port: 0'), 'node.rs must emit the port-0 shape');
    assert.ok(nodeRs.includes('no dev server'), 'source must say why');
  });

  it('readiness falls back to the CDP port when there is no dev port', () => {
    assert.ok(dsm.includes('const readinessPort = cdpPort || server.port'), 'watchStartup: CDP-first readiness');
    assert.ok(dsm.includes('const pulsePort = state.port || state.cdpPort'), 'health sweep fallback');
    assert.ok(dsm.includes('const verifyPort = state.port || state.cdpPort || server.port'), 'stale-running verify fallback');
  });

  it('port 0 never participates in port dedupe or busy checks', () => {
    assert.ok(pipeRs.includes('dev_port != 0 &&'), 'pre-flight busy check must skip port 0');
    assert.ok(pipeRs.includes('.filter(|p| *p != 0)'), 'post-ack polling must drop port 0');
  });
});

describe('custom-launcher Tauri apps (bespoke monorepos like yaak)', () => {
  const nodeRs = read('src-tauri', 'src', 'services', 'dev_server', 'node.rs');
  const modRs = read('src-tauri', 'src', 'services', 'dev_server', 'mod.rs');
  const dsm = read('src', 'lib', 'stores', 'dev-server-manager.svelte.js');

  it('finds tauri.conf.json outside <root>/src-tauri', () => {
    assert.ok(nodeRs.includes('fn find_tauri_conf_anywhere'), 'has the broad conf finder');
    assert.ok(nodeRs.includes('crates-tauri'), 'scans crates-tauri/* (the yaak layout)');
  });

  it('runs the project OWN root dev/start script as the launcher', () => {
    assert.ok(nodeRs.includes('fn detect_tauri_via_custom_launcher'), 'has the custom-launcher detector');
    assert.ok(nodeRs.includes('["dev", "start"'), 'prefers the canonical run script');
  });

  it('the custom-launcher Tauri target takes precedence over a frontend dupe', () => {
    const block = modRs.split('detect_tauri_via_custom_launcher')[1] || '';
    assert.ok(block.includes('servers.retain('), 'drops a same-port frontend entry');
    assert.ok(modRs.includes('!servers.iter().any(|s| s.framework.eq_ignore_ascii_case("tauri"))'),
      'only a FALLBACK — never overrides standard Tauri detection');
  });

  it('Tauri readiness tracks the CDP port (window), not the early frontend port', () => {
    assert.ok(dsm.includes('const readinessPort = cdpPort || server.port'),
      'CDP port is the readiness signal for a native app');
  });
});
