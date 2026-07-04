/**
 * claude-usage.test.cjs -- Source-inspection tests for the usage-pulse backend.
 *
 * Covers the status-line shim, the JSON capture + watcher service, the
 * settings.json wiring (with claude-pulse coexistence), and app-boot startup.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf-8');

const service = read('src-tauri/src/services/claude_usage.rs');
const statusLine = read('src-tauri/src/providers/cli/status_line.rs');
const mcpBin = read('src-tauri/src/bin/mcp.rs');
const servicesMod = read('src-tauri/src/services/mod.rs');
const libRs = read('src-tauri/src/lib.rs');

describe('claude_usage.rs: parse + capture', () => {
  it('parses the model, stripping the "Claude " prefix', () => {
    assert.ok(service.includes('strip_prefix("Claude ")'), 'Should strip the Claude prefix');
  });

  it('parses context, cost, worktree, and rate limits', () => {
    for (const field of ['context_window', 'total_cost_usd', 'worktree', 'rate_limits']) {
      assert.ok(service.includes(field), `Should read ${field}`);
    }
  });

  it('handles the optional "data" wrapper', () => {
    assert.ok(service.includes('v.get("data").unwrap_or(&v)'), 'Should unwrap an optional data envelope');
  });

  it('captures rate-limit windows including per-model', () => {
    for (const w of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
      assert.ok(service.includes(w), `Should parse ${w} window`);
    }
    assert.ok(service.includes('has_rate_limits'), 'Should flag rate-limit availability');
  });

  it('writes the status file atomically (temp + rename)', () => {
    assert.ok(service.includes('write_status_json'), 'Should expose write_status_json');
    assert.ok(service.includes('json.tmp') && service.includes('std::fs::rename'), 'Should temp-write then rename');
  });

  it('resolves the status path via the shared platform config dir', () => {
    assert.ok(service.includes('platform::get_config_dir()'), 'Should use the shared config dir');
    assert.ok(service.includes('claude-status.json'), 'Should name the status file');
  });

  it('renders an ASCII-safe fallback terminal line', () => {
    assert.ok(service.includes('render_fallback_line'), 'Should expose render_fallback_line');
  });
});

describe('claude_usage.rs: watcher emits ai-usage', () => {
  it('watches with notify and debounces changes', () => {
    assert.ok(service.includes('RecommendedWatcher') && service.includes('recommended_watcher'), 'Should use notify');
    assert.ok(service.includes('recv_timeout'), 'Should debounce via a channel');
  });

  it('emits the ai-usage Tauri event', () => {
    assert.ok(service.includes('emit("ai-usage"'), 'Should emit ai-usage');
  });

  it('emits an initial snapshot at startup', () => {
    assert.ok(service.includes('emit_from_file(&status_path, &app_handle)'), 'Should emit current state on start');
  });
});

describe('mcp.rs: status-line shim subcommand', () => {
  it('branches on the "statusline" arg before any heavy setup', () => {
    const idx = mcpBin.indexOf('== Some("statusline")');
    const loggingIdx = mcpBin.indexOf('tracing_subscriber::registry()');
    assert.ok(idx !== -1, 'Should branch on statusline');
    assert.ok(idx < loggingIdx, 'Shim branch must run before logging/IPC setup');
  });

  it('captures stdin JSON via write_status_json', () => {
    assert.ok(mcpBin.includes('claude_usage::write_status_json'), 'Should capture stdin to the status file');
  });

  it('supports --passthrough for delegating to an existing renderer', () => {
    assert.ok(mcpBin.includes('--passthrough'), 'Should support passthrough mode');
    assert.ok(mcpBin.includes('render_fallback_line'), 'Standalone mode renders its own line');
  });
});

describe('status_line.rs: workspace-scoped wiring + coexistence', () => {
  it('points the statusLine at our shim binary', () => {
    assert.ok(statusLine.includes('resolve_mcp_binary'), 'Should resolve the mcp shim binary');
    assert.ok(statusLine.includes('statusline'), 'Should invoke the statusline subcommand');
  });

  it('writes to workspace-local settings.local.json, not global settings.json', () => {
    assert.ok(statusLine.includes('settings.local.json'), 'Should write workspace-local settings');
    assert.ok(statusLine.includes('write_workspace_status_line'), 'Should have a workspace writer');
  });

  it('wraps an existing status line via passthrough (preserves claude-pulse)', () => {
    assert.ok(statusLine.includes('statusline --passthrough | '), 'Should pipe into the prior renderer');
    assert.ok(statusLine.includes('PASSTHROUGH_MARKER'), 'Should use the passthrough marker');
  });

  it('reads the delegate from global and restores a previously-wrapped global file', () => {
    assert.ok(statusLine.includes('read_global_delegate_and_restore'), 'Should read + restore global');
    assert.ok(statusLine.includes('unwrap_shim'), 'Should unwrap a prior global wrap');
  });

  it('writes the workspace file to the Claude cwd (cwd_override) as well as root', () => {
    assert.ok(statusLine.includes('cwd_override'), 'Should honour the Claude cwd');
  });

  it('is idempotent — skips the write when the command already matches', () => {
    assert.ok(
      statusLine.includes('["command"].as_str() == Some(command)'),
      'Should skip an unchanged workspace write'
    );
  });

  it('quotes the binary path for POSIX-shell status lines', () => {
    assert.ok(statusLine.includes('format!("\\"{}\\"", mcp_bin)'), 'Should quote the shim path');
  });
});

describe('boot-clear: no stale snapshot flashes on launch', () => {
  it('claude_usage exposes clear_status_file', () => {
    assert.ok(service.includes('pub fn clear_status_file'), 'Should expose clear_status_file');
  });

  it('lib.rs clears the status file before starting the watcher', () => {
    const clearIdx = libRs.indexOf('claude_usage::clear_status_file');
    const startIdx = libRs.indexOf('claude_usage::start_usage_watcher');
    assert.ok(clearIdx !== -1, 'Should call clear_status_file at boot');
    assert.ok(clearIdx < startIdx, 'Should clear before starting the watcher');
  });
});

describe('usage watcher: registration + startup', () => {
  it('registers the claude_usage module', () => {
    assert.ok(servicesMod.includes('pub mod claude_usage;'), 'Should declare the module');
  });

  it('starts the usage watcher at app boot', () => {
    assert.ok(libRs.includes('claude_usage::start_usage_watcher'), 'Should start the watcher in lib.rs');
  });
});
