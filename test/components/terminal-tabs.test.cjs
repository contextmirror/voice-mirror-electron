const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/components/terminal/TerminalTabs.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('TerminalTabs.svelte -- imports', () => {
  it('imports Terminal component', () => {
    assert.ok(src.includes("import Terminal from"), 'Should import Terminal');
  });

  it('imports ShellTerminal component', () => {
    assert.ok(src.includes("import ShellTerminal from"), 'Should import ShellTerminal');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports projectStore', () => {
    assert.ok(src.includes('projectStore'), 'Should import projectStore');
  });
});

describe('TerminalTabs.svelte -- structure', () => {
  it('has terminal-tabs-container class', () => {
    assert.ok(src.includes('terminal-tabs-container'), 'Should have container class');
  });

  it('has terminal-tab-bar class', () => {
    assert.ok(src.includes('terminal-tab-bar'), 'Should have tab bar class');
  });

  it('has terminal-panels class', () => {
    assert.ok(src.includes('terminal-panels'), 'Should have panels class');
  });

  it('has terminal-panel class', () => {
    assert.ok(src.includes('terminal-panel'), 'Should have panel class');
  });
});

describe('TerminalTabs.svelte -- tab bar', () => {
  it('iterates tabs with each block', () => {
    assert.ok(src.includes('{#each terminalTabsStore.tabs'), 'Should iterate tabs');
  });

  it('has class:active directive', () => {
    assert.ok(src.includes('class:active='), 'Should have active class binding');
  });

  it('has class:exited directive', () => {
    assert.ok(src.includes('class:exited='), 'Should have exited class binding');
  });

  it('has class:hidden directive', () => {
    assert.ok(src.includes('class:hidden='), 'Should have hidden class binding');
  });

  it('has tab-close button for shell tabs', () => {
    assert.ok(src.includes('tab-close'), 'Should have close button');
  });

  it('has tab-add button', () => {
    assert.ok(src.includes('tab-add'), 'Should have add button');
  });

  it('uses stopPropagation on close button', () => {
    assert.ok(src.includes('stopPropagation'), 'Should stop propagation on close');
  });

  it('has aria-label on add button', () => {
    assert.ok(src.includes('aria-label="New terminal"'), 'Should have aria-label');
  });
});

describe('TerminalTabs.svelte -- terminal rendering', () => {
  it('renders AI Terminal always', () => {
    assert.ok(src.includes('<Terminal'), 'Should render Terminal component');
  });

  it('renders ShellTerminal with shellId prop', () => {
    assert.ok(src.includes('shellId={tab.shellId}'), 'Should pass shellId prop');
  });

  it('passes visible prop to ShellTerminal', () => {
    assert.ok(src.includes('visible={'), 'Should pass visible prop');
  });

  it('has handleAddShell function', () => {
    assert.ok(src.includes('handleAddShell'), 'Should have handleAddShell');
  });

  it('uses keyed each block for tabs', () => {
    assert.ok(src.includes('(tab.id)'), 'Should use keyed each block');
  });
});

describe('TerminalTabs.svelte -- tab renaming', () => {
  it('has editingTabId state', () => {
    assert.ok(src.includes('editingTabId'), 'Should have editingTabId state');
  });

  it('has startRename function', () => {
    assert.ok(src.includes('startRename'), 'Should have startRename');
  });

  it('has saveRename function', () => {
    assert.ok(src.includes('saveRename'), 'Should have saveRename');
  });

  it('has cancelRename function', () => {
    assert.ok(src.includes('cancelRename'), 'Should have cancelRename');
  });

  it('has inline rename input', () => {
    assert.ok(src.includes('tab-rename-input'), 'Should have rename input class');
  });

  it('triggers rename on double-click', () => {
    assert.ok(src.includes('ondblclick'), 'Should have dblclick handler on tab label');
  });

  it('saves on Enter key', () => {
    assert.ok(src.includes("e.key === 'Enter'"), 'Should save on Enter');
  });

  it('cancels on Escape key', () => {
    assert.ok(src.includes("e.key === 'Escape'"), 'Should cancel on Escape');
  });

  it('has autofocus action for rename input', () => {
    assert.ok(src.includes('use:autofocus'), 'Should auto-focus rename input');
  });
});

describe('TerminalTabs.svelte -- context menu', () => {
  it('has context-menu class', () => {
    assert.ok(src.includes('context-menu'), 'Should have context menu element');
  });

  it('has showContextMenu function', () => {
    assert.ok(src.includes('showContextMenu'), 'Should have showContextMenu');
  });

  it('triggers on right-click', () => {
    assert.ok(src.includes('oncontextmenu'), 'Should have contextmenu handler');
  });

  it('has Rename menu item', () => {
    assert.ok(src.includes('contextRename'), 'Should have rename action');
  });

  it('has Clear menu item', () => {
    assert.ok(src.includes('contextClear'), 'Should have clear action');
  });

  it('has Close menu item for shell tabs', () => {
    assert.ok(src.includes('contextClose'), 'Should have close action');
  });

  it('hides Close for AI tab', () => {
    assert.ok(src.includes("contextMenu.tabId !== 'ai'"), 'Should hide close for AI tab');
  });

  it('closes on outside click', () => {
    assert.ok(src.includes('closeContextMenu'), 'Should close on outside click');
  });

  it('uses fixed positioning', () => {
    assert.ok(src.includes('position: fixed'), 'Context menu should be fixed positioned');
  });
});

describe('TerminalTabs.svelte -- drag-to-reorder', () => {
  it('has draggable attribute on shell tabs', () => {
    assert.ok(src.includes("draggable={tab.type === 'shell'}"), 'Shell tabs should be draggable');
  });

  it('has drag-over class binding', () => {
    assert.ok(src.includes('class:drag-over='), 'Should have drag-over class');
  });

  it('has dragging class binding', () => {
    assert.ok(src.includes('class:dragging='), 'Should have dragging class');
  });

  it('has handleDragStart function', () => {
    assert.ok(src.includes('handleDragStart'), 'Should have dragstart handler');
  });

  it('has handleDrop function', () => {
    assert.ok(src.includes('handleDrop'), 'Should have drop handler');
  });

  it('calls moveTab on drop', () => {
    assert.ok(src.includes('moveTab(dragTabId'), 'Should call moveTab');
  });

  it('prevents dragging AI tab', () => {
    assert.ok(src.includes("tabId === 'ai'") && src.includes('e.preventDefault'), 'Should prevent dragging AI tab');
  });
});

describe('TerminalTabs.svelte -- keyboard cycling', () => {
  it('listens for Ctrl+Tab', () => {
    assert.ok(src.includes("e.key === 'Tab'"), 'Should listen for Tab key');
  });

  it('checks ctrlKey modifier', () => {
    assert.ok(src.includes('e.ctrlKey'), 'Should check ctrlKey');
  });

  it('calls nextTab on Ctrl+Tab', () => {
    assert.ok(src.includes('nextTab()'), 'Should call nextTab');
  });

  it('calls prevTab on Ctrl+Shift+Tab', () => {
    assert.ok(src.includes('prevTab()'), 'Should call prevTab');
  });

  it('uses capture phase for global keydown', () => {
    assert.ok(src.includes("'keydown', handleKeydown, true"), 'Should use capture phase');
  });
});

describe('TerminalTabs.svelte -- CSS', () => {
  it('hides inactive panels with display none', () => {
    assert.ok(src.includes('display: none'), 'Should hide inactive panels');
  });

  it('uses position absolute for panels', () => {
    assert.ok(src.includes('position: absolute'), 'Should use absolute positioning');
  });
});
