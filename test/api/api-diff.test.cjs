/**
 * api-diff.test.cjs -- Source-inspection tests for getFileGitContent API wrapper
 *
 * Verifies the getFileGitContent function exists in api.js with correct
 * invoke() call and parameter passing for fetching git HEAD content.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/api.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('api.js -- getFileGitContent', () => {
  it('exports async function getFileGitContent', () => {
    assert.ok(
      src.includes('export async function getFileGitContent('),
      'Should export getFileGitContent'
    );
  });

  it('invokes get_file_git_content command', () => {
    assert.ok(
      src.includes("invoke('get_file_git_content'"),
      'Should call invoke with get_file_git_content'
    );
  });

  it('accepts path and root parameters', () => {
    assert.ok(
      src.includes('getFileGitContent(path, root)') || src.includes('getFileGitContent(path,root)'),
      'Should accept path and root parameters'
    );
  });

  it('passes path to invoke', () => {
    // Extract the invoke call for get_file_git_content
    const invokeIdx = src.indexOf("invoke('get_file_git_content'");
    assert.ok(invokeIdx !== -1, 'Should have invoke call');
    const snippet = src.slice(invokeIdx, invokeIdx + 100);
    assert.ok(snippet.includes('path'), 'Should pass path to invoke');
  });

  it('passes root || null to invoke', () => {
    // The function should coerce falsy root to null
    const fnStart = src.indexOf('function getFileGitContent(');
    const fnEnd = src.indexOf('}', src.indexOf("invoke('get_file_git_content'"));
    const fnBody = src.slice(fnStart, fnEnd + 1);
    assert.ok(
      fnBody.includes('root || null') || fnBody.includes('root ?? null'),
      'Should pass root || null to invoke'
    );
  });

  it('has JSDoc describing return shape', () => {
    // Check that there's documentation near the function
    const fnIdx = src.indexOf('function getFileGitContent(');
    const preceding = src.slice(Math.max(0, fnIdx - 300), fnIdx);
    assert.ok(
      preceding.includes('content') && preceding.includes('isNew'),
      'Should document content and isNew in return shape'
    );
  });

  it('documents binary return case', () => {
    const fnIdx = src.indexOf('function getFileGitContent(');
    const preceding = src.slice(Math.max(0, fnIdx - 300), fnIdx);
    assert.ok(
      preceding.includes('binary'),
      'Should document binary file case'
    );
  });
});
