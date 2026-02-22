/**
 * markdown.test.js -- Source-inspection tests for tauri/src/lib/markdown.js
 *
 * This is a plain .js file (not .svelte.js) that uses ES module syntax.
 * We still use source-inspection since it imports browser-only modules
 * (marked, DOMPurify) that aren't available in Node.js test environment.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/markdown.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('markdown.js -- exports', () => {
  it('exports renderMarkdown function', () => {
    assert.ok(src.includes('export function renderMarkdown'), 'Should export renderMarkdown');
  });
});

describe('markdown.js -- dependencies', () => {
  it('imports marked library', () => {
    assert.ok(src.includes("from 'marked'"), 'Should import from marked');
    assert.ok(src.includes('marked'), 'Should import marked');
  });

  it('imports DOMPurify for XSS prevention', () => {
    assert.ok(src.includes("import DOMPurify from 'dompurify'"), 'Should import DOMPurify');
  });
});

describe('markdown.js -- marked configuration', () => {
  it('calls marked.setOptions', () => {
    assert.ok(src.includes('marked.setOptions'), 'Should configure marked');
  });

  it('enables breaks (GFM line breaks)', () => {
    assert.ok(src.includes('breaks: true'), 'Should enable line breaks');
  });

  it('enables gfm (GitHub-flavored markdown)', () => {
    assert.ok(src.includes('gfm: true'), 'Should enable GFM');
  });

  it('uses synchronous parsing', () => {
    assert.ok(src.includes('async: false'), 'Should use synchronous parsing');
  });
});

describe('markdown.js -- renderMarkdown implementation', () => {
  it('handles empty/falsy input', () => {
    assert.ok(src.includes("if (!text) return ''"), 'Should return empty string for falsy input');
  });

  it('calls marked.parse on input text', () => {
    assert.ok(src.includes('marked.parse(text)'), 'Should call marked.parse');
  });

  it('sanitizes output with DOMPurify.sanitize', () => {
    assert.ok(src.includes('DOMPurify.sanitize'), 'Should sanitize HTML output');
  });

  it('returns sanitized HTML string', () => {
    assert.ok(src.includes('return DOMPurify.sanitize(raw'), 'Should return sanitized result');
  });
});

describe('markdown.js -- collapsible code blocks', () => {
  it('imports Renderer from marked', () => {
    assert.ok(src.includes("import { marked, Renderer } from 'marked'"), 'Should import Renderer');
  });

  it('defines COLLAPSE_LINE_THRESHOLD constant', () => {
    assert.ok(src.includes('COLLAPSE_LINE_THRESHOLD'), 'Should define threshold constant');
  });

  it('sets threshold to 10 lines', () => {
    assert.ok(src.includes('COLLAPSE_LINE_THRESHOLD = 10'), 'Threshold should be 10');
  });

  it('creates custom renderer instance', () => {
    assert.ok(src.includes('new Renderer()'), 'Should create renderer');
  });

  it('saves default code renderer', () => {
    assert.ok(src.includes('renderer.code.bind(renderer)'), 'Should bind default code renderer');
  });

  it('overrides renderer.code function', () => {
    assert.ok(src.includes('renderer.code = function'), 'Should override code renderer');
  });

  it('counts lines using newline matches', () => {
    assert.ok(src.includes("text.match(/\\n/g)"), 'Should count newlines');
  });

  it('compares lineCount to threshold', () => {
    assert.ok(src.includes('lineCount <= COLLAPSE_LINE_THRESHOLD'), 'Should compare to threshold');
  });

  it('wraps long code in <details> with code-collapse class', () => {
    assert.ok(src.includes('code-collapse'), 'Should use code-collapse class');
    assert.ok(src.includes('<details'), 'Should use <details> element');
    assert.ok(src.includes('<summary>'), 'Should use <summary> element');
  });

  it('includes language and line count in summary label', () => {
    assert.ok(src.includes('lineCount} lines'), 'Should show line count');
    assert.ok(src.includes('lang ?'), 'Should conditionally include language');
  });

  it('passes custom renderer to marked.setOptions', () => {
    assert.ok(src.includes('renderer,') || src.includes('renderer }'), 'Should pass renderer to marked');
  });

  it('configures DOMPurify to allow details and summary tags', () => {
    assert.ok(src.includes("ADD_TAGS"), 'Should use ADD_TAGS');
    assert.ok(src.includes("'details'"), 'Should allow details tag');
    assert.ok(src.includes("'summary'"), 'Should allow summary tag');
  });

  it('passes PURIFY_CONFIG to DOMPurify.sanitize', () => {
    assert.ok(src.includes('DOMPurify.sanitize(raw, PURIFY_CONFIG)'), 'Should pass config to sanitize');
  });
});

describe('markdown.js -- JSDoc documentation', () => {
  it('documents text parameter', () => {
    assert.ok(src.includes('@param {string} text'), 'Should document text param');
  });

  it('documents return type', () => {
    assert.ok(src.includes('@returns {string}'), 'Should document return type');
  });

  it('mentions sanitized HTML in docs', () => {
    assert.ok(
      src.includes('Sanitized HTML') || src.includes('sanitized') || src.includes('Sanitize'),
      'Should mention sanitization in docs'
    );
  });
});
