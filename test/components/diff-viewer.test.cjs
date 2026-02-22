/**
 * diff-viewer.test.cjs -- Source-inspection tests for DiffViewer.svelte
 *
 * Validates the diff viewer component that shows unified diffs using CodeMirror merge.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/DiffViewer.svelte'),
  'utf-8'
);

describe('DiffViewer.svelte: imports', () => {
  it('imports readFile from api.js', () => {
    assert.ok(src.includes('readFile'), 'Should import readFile');
    assert.ok(src.includes('api.js'), 'Should import from api.js');
  });

  it('imports getFileGitContent from api.js', () => {
    assert.ok(src.includes('getFileGitContent'), 'Should import getFileGitContent');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });

  it('imports onMount and onDestroy from svelte', () => {
    assert.ok(src.includes('onMount'), 'Should import onMount');
    assert.ok(src.includes('onDestroy'), 'Should import onDestroy');
  });

  it('imports tick from svelte', () => {
    assert.ok(src.includes('tick'), 'Should import tick');
  });
});

describe('DiffViewer.svelte: props and state', () => {
  it('uses $props() for tab prop', () => {
    assert.ok(src.includes('$props()'), 'Should use $props()');
    assert.ok(src.includes('tab'), 'Should destructure tab from props');
  });

  it('has loading state', () => {
    assert.ok(src.includes('loading'), 'Should have loading state');
    assert.ok(src.includes('$state(true)'), 'loading should default to true');
  });

  it('has error state', () => {
    assert.ok(src.includes('error'), 'Should have error state');
  });

  it('has isBinary state', () => {
    assert.ok(src.includes('isBinary'), 'Should have isBinary state');
  });

  it('has stats state for additions/deletions', () => {
    assert.ok(src.includes('stats'), 'Should have stats state');
    assert.ok(src.includes('additions'), 'Should track additions');
    assert.ok(src.includes('deletions'), 'Should track deletions');
  });
});

describe('DiffViewer.svelte: CodeMirror merge', () => {
  it('dynamically imports @codemirror/merge', () => {
    assert.ok(src.includes('@codemirror/merge'), 'Should import @codemirror/merge');
  });

  it('uses unifiedMergeView', () => {
    assert.ok(src.includes('unifiedMergeView'), 'Should use unifiedMergeView');
  });

  it('sets editor as read-only', () => {
    assert.ok(
      src.includes('EditorView.editable.of(false)'),
      'Should set editable to false'
    );
    assert.ok(
      src.includes('EditorState.readOnly.of(true)'),
      'Should set readOnly to true'
    );
  });

  it('configures mergeControls: false', () => {
    assert.ok(src.includes('mergeControls: false'), 'Should disable merge controls');
  });

  it('configures highlightChanges: true', () => {
    assert.ok(src.includes('highlightChanges: true'), 'Should enable change highlighting');
  });

  it('configures gutter: true', () => {
    assert.ok(src.includes('gutter: true'), 'Should enable gutter');
  });
});

describe('DiffViewer.svelte: loadLanguage', () => {
  it('has loadLanguage function', () => {
    assert.ok(src.includes('function loadLanguage'), 'Should have loadLanguage function');
  });

  it('supports JavaScript (js/jsx/mjs/cjs)', () => {
    assert.ok(src.includes("'js'"), 'Should handle js extension');
    assert.ok(src.includes("'jsx'"), 'Should handle jsx extension');
    assert.ok(src.includes("'mjs'"), 'Should handle mjs extension');
    assert.ok(src.includes("'cjs'"), 'Should handle cjs extension');
  });

  it('supports TypeScript (ts/tsx)', () => {
    assert.ok(src.includes("'ts'"), 'Should handle ts extension');
    assert.ok(src.includes("'tsx'"), 'Should handle tsx extension');
    assert.ok(src.includes('typescript: true'), 'Should enable typescript mode');
  });

  it('supports Rust', () => {
    assert.ok(src.includes("'rs'"), 'Should handle rs extension');
    assert.ok(src.includes('@codemirror/lang-rust'), 'Should import rust language');
  });

  it('supports CSS/SCSS', () => {
    assert.ok(src.includes("'css'"), 'Should handle css extension');
    assert.ok(src.includes("'scss'"), 'Should handle scss extension');
    assert.ok(src.includes('@codemirror/lang-css'), 'Should import css language');
  });

  it('supports HTML/Svelte', () => {
    assert.ok(src.includes("'html'"), 'Should handle html extension');
    assert.ok(src.includes("'svelte'"), 'Should handle svelte extension');
    assert.ok(src.includes('@codemirror/lang-html'), 'Should import html language');
  });

  it('supports JSON', () => {
    assert.ok(src.includes("'json'"), 'Should handle json extension');
    assert.ok(src.includes('@codemirror/lang-json'), 'Should import json language');
  });

  it('supports Markdown', () => {
    assert.ok(src.includes("'md'"), 'Should handle md extension');
    assert.ok(src.includes("'markdown'"), 'Should handle markdown extension');
    assert.ok(src.includes('@codemirror/lang-markdown'), 'Should import markdown language');
  });

  it('supports Python', () => {
    assert.ok(src.includes("'py'"), 'Should handle py extension');
    assert.ok(src.includes("'python'"), 'Should handle python extension');
    assert.ok(src.includes('@codemirror/lang-python'), 'Should import python language');
  });
});

describe('DiffViewer.svelte: countChanges', () => {
  it('has countChanges function', () => {
    assert.ok(src.includes('function countChanges'), 'Should have countChanges function');
  });

  it('counts additions and deletions', () => {
    assert.ok(src.includes('additions'), 'Should count additions');
    assert.ok(src.includes('deletions'), 'Should count deletions');
  });

  it('splits content by newlines', () => {
    assert.ok(src.includes(".split('\\n')"), 'Should split content into lines');
  });
});

describe('DiffViewer.svelte: binary file handling', () => {
  it('checks for binary files', () => {
    assert.ok(src.includes('binary'), 'Should check for binary content');
    assert.ok(src.includes('isBinary'), 'Should set isBinary state');
  });

  it('shows binary file placeholder', () => {
    assert.ok(src.includes('Binary file'), 'Should display binary file message');
    assert.ok(
      src.includes('Cannot show diff for binary files'),
      'Should explain binary limitation'
    );
  });
});

describe('DiffViewer.svelte: lifecycle', () => {
  it('loads diff on mount', () => {
    assert.ok(src.includes('onMount('), 'Should use onMount for initialization');
  });

  it('destroys view on cleanup', () => {
    assert.ok(src.includes('onDestroy('), 'Should use onDestroy for cleanup');
    assert.ok(src.includes('view?.destroy()'), 'Should destroy CodeMirror view');
  });
});

describe('DiffViewer.svelte: CSS classes', () => {
  it('has diff-viewer class', () => {
    assert.ok(src.includes('.diff-viewer'), 'Should have diff-viewer CSS class');
  });

  it('has diff-toolbar class', () => {
    assert.ok(src.includes('.diff-toolbar'), 'Should have diff-toolbar CSS class');
  });

  it('has diff-stats class', () => {
    assert.ok(src.includes('.diff-stats'), 'Should have diff-stats CSS class');
  });

  it('has stat-add and stat-del classes', () => {
    assert.ok(src.includes('.stat-add'), 'Should have stat-add CSS class');
    assert.ok(src.includes('.stat-del'), 'Should have stat-del CSS class');
  });

  it('has diff-loading class', () => {
    assert.ok(src.includes('.diff-loading'), 'Should have diff-loading CSS class');
  });

  it('has diff-placeholder class', () => {
    assert.ok(src.includes('.diff-placeholder'), 'Should have diff-placeholder CSS class');
  });
});
