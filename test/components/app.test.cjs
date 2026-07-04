/**
 * app.test.cjs -- Source-inspection tests for App.svelte
 *
 * The AI provider status pill moved OUT of the titlebar down to the bottom
 * status bar (see status-bar.test.cjs → "AI provider pill"). The titlebar
 * centerContent now holds only the command-palette search trigger.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/App.svelte'),
  'utf-8'
);

describe('App.svelte -- titlebar no longer hosts the provider pill', () => {
  it('does not render the provider status pill in the titlebar', () => {
    assert.ok(!src.includes('titlebar-provider-status'), 'Provider pill should have moved to the status bar');
    assert.ok(!src.includes('titlebar-status-dot'), 'Status dot should have moved to the status bar');
  });

  it('keeps the command-palette search trigger in the titlebar center', () => {
    assert.ok(src.includes('titlebar-search-trigger'), 'Search trigger should remain in the titlebar');
  });
});

describe('App.svelte -- auto-start provider gating', () => {
  it('checks ai.autoStart config before starting provider', () => {
    assert.ok(src.includes('autoStart'), 'Should reference autoStart config');
  });

  it('always auto-starts dictation provider regardless of autoStart', () => {
    assert.ok(
      src.includes("provider === 'dictation'"),
      'Should carve out dictation from autoStart check'
    );
  });

  it('has providerStarted guard to prevent re-starts', () => {
    assert.ok(src.includes('providerStarted'), 'Should have providerStarted one-shot guard');
  });
});

describe('App.svelte -- lens-shortcut listen() unlisten race', () => {
  it('resolves through a cancelled flag so cleanup-before-resolve does not leak the listener', () => {
    const start = src.indexOf("listen('lens-shortcut'");
    assert.ok(start !== -1, 'lens-shortcut listener exists');
    const chunk = src.slice(Math.max(0, start - 300), start + 1800);
    assert.ok(chunk.includes('let cancelled = false'), 'effect declares a cancelled flag');
    assert.ok(chunk.includes('if (cancelled) { fn(); return; }'), 'resolve-after-cleanup unsubscribes immediately');
    assert.ok(chunk.includes('cancelled = true; unlistenFn?.();'), 'cleanup sets the flag and unsubscribes');
  });
});
