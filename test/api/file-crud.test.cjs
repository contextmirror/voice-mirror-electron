/**
 * file-crud.test.cjs -- Source-inspection tests for file CRUD API wrappers in api.js
 *
 * Validates the 5 new file CRUD functions: createFile, createDirectory,
 * renameEntry, deleteEntry, revealInExplorer.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- createFile', () => {
  it('exports async function createFile', () => {
    assert.ok(src.includes('export async function createFile('), 'Should export createFile');
  });

  it('invokes create_file command', () => {
    assert.ok(src.includes("invoke('create_file'"), 'Should invoke create_file');
  });

  it('passes path parameter', () => {
    assert.ok(src.includes("{ path, content:"), 'Should pass path');
  });

  it('passes content parameter with null fallback', () => {
    assert.ok(src.includes("content: content || null"), 'Should pass content with null fallback');
  });
});

describe('api.js -- createDirectory', () => {
  it('exports async function createDirectory', () => {
    assert.ok(src.includes('export async function createDirectory('), 'Should export createDirectory');
  });

  it('invokes create_directory command', () => {
    assert.ok(src.includes("invoke('create_directory'"), 'Should invoke create_directory');
  });
});

describe('api.js -- renameEntry', () => {
  it('exports async function renameEntry', () => {
    assert.ok(src.includes('export async function renameEntry('), 'Should export renameEntry');
  });

  it('invokes rename_entry command', () => {
    assert.ok(src.includes("invoke('rename_entry'"), 'Should invoke rename_entry');
  });

  it('passes oldPath and newPath parameters', () => {
    assert.ok(src.includes('oldPath, newPath'), 'Should accept oldPath and newPath');
  });
});

describe('api.js -- deleteEntry', () => {
  it('exports async function deleteEntry', () => {
    assert.ok(src.includes('export async function deleteEntry('), 'Should export deleteEntry');
  });

  it('invokes delete_entry command', () => {
    assert.ok(src.includes("invoke('delete_entry'"), 'Should invoke delete_entry');
  });
});

describe('api.js -- revealInExplorer', () => {
  it('exports async function revealInExplorer', () => {
    assert.ok(src.includes('export async function revealInExplorer('), 'Should export revealInExplorer');
  });

  it('invokes reveal_in_explorer command', () => {
    assert.ok(src.includes("invoke('reveal_in_explorer'"), 'Should invoke reveal_in_explorer');
  });
});
