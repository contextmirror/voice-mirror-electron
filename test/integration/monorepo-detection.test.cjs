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
