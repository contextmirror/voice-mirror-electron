/**
 * search-files.test.cjs -- Source-inspection tests for the searchFiles API function
 *
 * Verifies that searchFiles is exported and calls invoke('search_files', ...)
 * with the correct parameters.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- searchFiles function', () => {
  it('exports searchFiles as an async function', () => {
    assert.ok(
      src.includes('export async function searchFiles('),
      'Should export async function searchFiles'
    );
  });

  it('calls invoke with "search_files" command', () => {
    assert.ok(
      src.includes("invoke('search_files'"),
      'Should call invoke("search_files")'
    );
  });

  it('passes root parameter to invoke', () => {
    assert.ok(
      src.includes("invoke('search_files', { root:"),
      'Should pass root parameter to invoke'
    );
  });

  it('accepts root as parameter', () => {
    assert.ok(
      src.includes('function searchFiles(root)'),
      'searchFiles should accept root parameter'
    );
  });

  it('defaults root to null when not provided', () => {
    assert.ok(
      src.includes('root: root || null'),
      'Should default root to null'
    );
  });

  it('has JSDoc comment describing the function', () => {
    // The function has a JSDoc comment with description
    assert.ok(
      src.includes('Recursively list all files'),
      'Should have JSDoc describing recursive file listing'
    );
  });

  it('mentions .gitignore in documentation', () => {
    assert.ok(
      src.includes('.gitignore'),
      'JSDoc should mention .gitignore respect'
    );
  });

  it('is in the Files section', () => {
    // searchFiles should be after the Files section comment
    const filesSectionIndex = src.indexOf('// ============ Files');
    const searchFilesIndex = src.indexOf('export async function searchFiles');
    assert.ok(filesSectionIndex > 0, 'Should have a Files section');
    assert.ok(searchFilesIndex > filesSectionIndex, 'searchFiles should be in the Files section');
  });
});
