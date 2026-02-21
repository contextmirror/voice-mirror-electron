/**
 * tab-bar.test.cjs -- Source-inspection tests for TabBar.svelte
 *
 * Validates the tab strip UI component for Lens mode.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/components/lens/TabBar.svelte'),
  'utf-8'
);

describe('TabBar.svelte', () => {
  it('imports tabsStore', () => {
    assert.ok(src.includes('tabsStore'), 'Should import tabsStore');
  });

  it('has tab-bar CSS class', () => {
    assert.ok(src.includes('tab-bar'), 'Should have tab-bar class');
  });

  it('has tab buttons for each tab', () => {
    assert.ok(src.includes('class="tab"') || src.includes("class='tab'"), 'Should have tab class');
  });

  it('has class:active directive', () => {
    assert.ok(src.includes('class:active'), 'Should use class:active');
  });

  it('has class:preview directive', () => {
    assert.ok(src.includes('class:preview'), 'Should use class:preview');
  });

  it('has class:dirty directive', () => {
    assert.ok(src.includes('class:dirty'), 'Should use class:dirty');
  });

  it('has close button with tab-close class', () => {
    assert.ok(src.includes('tab-close'), 'Should have tab-close class');
  });

  it('has add button with tab-add class', () => {
    assert.ok(src.includes('tab-add'), 'Should have tab-add class');
  });

  it('has dirty-dot indicator', () => {
    assert.ok(src.includes('dirty-dot'), 'Should have dirty-dot class');
  });

  it('has aria-label on add button', () => {
    assert.ok(src.includes('aria-label="Open file"'), 'Should have aria-label on add');
  });

  it('uses @tauri-apps/plugin-dialog for file picker', () => {
    assert.ok(src.includes('@tauri-apps/plugin-dialog'), 'Should import dialog plugin');
  });

  it('has ondblclick for pinning tabs', () => {
    assert.ok(src.includes('ondblclick'), 'Should have ondblclick handler');
  });

  it('has stopPropagation on close button', () => {
    assert.ok(src.includes('stopPropagation'), 'Should prevent event bubbling on close');
  });

  it('has title attribute for full path', () => {
    assert.ok(src.includes('title={tab.path'), 'Should show full path on hover');
  });

  it('renders tab title', () => {
    assert.ok(src.includes('tab-title'), 'Should have tab-title element');
  });

  it('has tab icon SVG', () => {
    assert.ok(src.includes('tab-icon'), 'Should have tab-icon class');
  });

  it('preview tabs have italic title', () => {
    assert.ok(src.includes('font-style: italic'), 'Should italicize preview tab titles');
  });

  it('active tabs have accent indicator', () => {
    assert.ok(
      src.includes('box-shadow') || src.includes('border-bottom'),
      'Should have visual active indicator'
    );
  });

  it('has horizontal scrolling for overflow', () => {
    assert.ok(src.includes('overflow-x'), 'Should handle tab overflow');
  });
});

describe('TabBar.svelte: file picker', () => {
  it('has handleAddFile function', () => {
    assert.ok(src.includes('handleAddFile'), 'Should have add file handler');
  });

  it('opens dialog with multiple selection', () => {
    assert.ok(src.includes('multiple: true'), 'Should allow multiple file selection');
  });

  it('pins explicitly opened files', () => {
    assert.ok(src.includes('pinTab'), 'Should pin files opened via picker');
  });
});

describe('TabBar.svelte: icon mapping', () => {
  it('has getTabIcon function', () => {
    assert.ok(src.includes('getTabIcon'), 'Should have icon mapping function');
  });

  it('returns globe for browser tab', () => {
    assert.ok(src.includes("'globe'"), 'Should return globe for browser');
  });

  it('returns diff icon for diff tabs', () => {
    assert.ok(src.includes("'diff'"), 'Should return diff for diff tab type');
  });

  it('has file type detection', () => {
    assert.ok(src.includes("'code'") || src.includes("'file'"), 'Should detect file types');
  });
});

describe('TabBar.svelte: diff tab support', () => {
  it('has diff tab badge', () => {
    assert.ok(src.includes('tab-diff-badge'), 'Should have diff badge class');
  });

  it('shows status on diff badge (A/M/D)', () => {
    assert.ok(src.includes('tab.status'), 'Should reference tab status');
  });

  it('has diff icon SVG path', () => {
    // git-compare icon: two circles with connecting path
    assert.ok(
      src.includes("getTabIcon(tab) === 'diff'"),
      'Should render diff-specific icon'
    );
  });
});

