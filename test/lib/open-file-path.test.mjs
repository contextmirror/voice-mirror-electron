/**
 * open-file-path.test.mjs -- Tests for src/lib/open-file-path.js
 *
 * Shell "Open with Voice Mirror" path resolution: in-workspace files become
 * root-relative forward-slash entries; everything else external read-only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { entryForOpenPath } from '../../src/lib/open-file-path.js';

describe('entryForOpenPath', () => {
  it('maps a file inside the project root to a relative workspace entry', () => {
    const entry = entryForOpenPath('E:\\Projects\\Voice Mirror\\src\\App.svelte', 'E:\\Projects\\Voice Mirror');
    assert.deepEqual(entry, {
      name: 'App.svelte',
      path: 'src/App.svelte',
      external: false,
      readOnly: false,
    });
  });

  it('is case-insensitive on the root prefix (Windows)', () => {
    const entry = entryForOpenPath('e:\\projects\\voice mirror\\CLAUDE.md', 'E:\\Projects\\Voice Mirror');
    assert.equal(entry.external, false);
    assert.equal(entry.path, 'CLAUDE.md');
  });

  it('tolerates a trailing separator on the root', () => {
    const entry = entryForOpenPath('E:\\Projects\\Voice Mirror\\docs\\a.md', 'E:\\Projects\\Voice Mirror\\');
    assert.equal(entry.external, false);
    assert.equal(entry.path, 'docs/a.md');
  });

  it('does not treat a sibling folder with a shared prefix as inside the root', () => {
    const entry = entryForOpenPath('E:\\Projects\\Voice Mirror 2\\file.md', 'E:\\Projects\\Voice Mirror');
    assert.equal(entry.external, true);
  });

  it('maps a file outside the root to an external read-only entry', () => {
    const entry = entryForOpenPath('C:\\Users\\georg\\notes.md', 'E:\\Projects\\Voice Mirror');
    assert.deepEqual(entry, {
      name: 'notes.md',
      path: 'C:/Users/georg/notes.md',
      external: true,
      readOnly: true,
    });
  });

  it('is external read-only when there is no project root', () => {
    const entry = entryForOpenPath('E:\\somewhere\\file.txt', null);
    assert.equal(entry.external, true);
    assert.equal(entry.readOnly, true);
  });

  it('accepts forward-slash input paths', () => {
    const entry = entryForOpenPath('E:/Projects/Voice Mirror/README.md', 'E:\\Projects\\Voice Mirror');
    assert.equal(entry.external, false);
    assert.equal(entry.path, 'README.md');
  });
});
