/**
 * file-editor-unsaved-buffer.test.cjs -- guards the fix for the tab-switch
 * data-loss bug (launch BL3): switching the active tab destroys + recreates the
 * single CodeMirror view, so unsaved edits must be cached per-tab and restored.
 *
 * The cache is keyed by the group-agnostic BASE id (tab.id minus the `:gN`
 * suffix): tabsStore.moveTab() rewrites tab.id when a tab moves between editor
 * groups, and a group-keyed entry would be orphaned (then pruned), silently
 * dropping the unsaved edits.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../../../src/components/lens/editor/FileEditor.svelte'),
  'utf-8'
);

describe('FileEditor: unsaved-buffer preservation across tab switches', () => {
  it('maintains a per-tab unsaved-buffer cache', () => {
    assert.ok(src.includes('unsavedBuffers'), 'should keep an unsavedBuffers cache');
    assert.ok(/const unsavedBuffers = new Map\(\)/.test(src), 'cache is a Map');
  });

  it('keys the cache by the group-agnostic base id (survives cross-group moves)', () => {
    assert.ok(
      /const bufferKey = \(id\) => id\.replace\(\/:g\\d\+\$\/, ''\)/.test(src),
      'defines bufferKey stripping the :gN group suffix'
    );
    assert.ok(!src.includes('unsavedBuffers.set(loadedTab.id'), 'never keys by raw tab.id');
    assert.ok(!src.includes('unsavedBuffers.has(tab.id)'), 'never looks up by raw tab.id');
  });

  it('snapshots the outgoing tab buffer only when it is still dirty', () => {
    assert.ok(src.includes('unsavedBuffers.set(bufferKey(loadedTab.id)'), 'caches the leaving tab content');
    assert.ok(/prev\?\.dirty/.test(src), 'only caches when the tab is dirty (clean tabs re-read disk)');
  });

  it('re-seeds the cached buffer as the new editor doc on return', () => {
    assert.ok(src.includes('unsavedBuffers.has(bufferKey(tab.id))'), 'checks cache on load');
    assert.ok(src.includes('doc: initialDoc'), 'editor state uses the (possibly restored) initialDoc');
  });

  it('clears the cache entry once the tab is saved', () => {
    assert.ok(src.includes('unsavedBuffers.delete(bufferKey(tab.id))'), 'save() drops the stale cache entry');
  });
});

describe('FileEditor: unsaved-buffer cache pruned when tabs close', () => {
  it("prunes cache entries whose tab no longer exists (\"Don't Save\" must stick)", () => {
    assert.ok(
      src.includes('for (const key of [...unsavedBuffers.keys()])'),
      'loadFile sweeps the cache keys'
    );
    assert.ok(
      src.includes('!tabsStore.tabs.some((t) => bufferKey(t.id) === key)'),
      'compares BASE ids so a moved (re-namespaced) tab keeps its cached edits'
    );
    assert.ok(
      /if \(!tabsStore\.tabs\.some\(\(t\) => bufferKey\(t\.id\) === key\)\) \{\s*\n\s*unsavedBuffers\.delete\(key\);/.test(src),
      'deletes orphaned entries so a closed-without-saving tab cannot resurrect discarded edits'
    );
  });
});
