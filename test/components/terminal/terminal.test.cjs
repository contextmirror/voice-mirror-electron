const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../../src/components/terminal/Terminal.svelte');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('Terminal.svelte -- imports', () => {
  it('imports xterm.js Terminal, FitAddon and WebglAddon', () => {
    assert.ok(src.includes("import { Terminal } from '@xterm/xterm'"), 'Should import xterm.js Terminal');
    assert.ok(src.includes("import { FitAddon } from '@xterm/addon-fit'"), 'Should import FitAddon');
    assert.ok(src.includes("import { WebglAddon } from '@xterm/addon-webgl'"), 'Should import WebglAddon');
    assert.ok(!src.includes('ghostty'), 'Should not reference ghostty-web anymore');
  });

  it('imports terminalInput from api', () => {
    assert.ok(src.includes('terminalInput'), 'Should import terminalInput');
  });

  it('imports terminalResize from api', () => {
    assert.ok(src.includes('terminalResize'), 'Should import terminalResize');
  });

  it('imports listen from tauri events', () => {
    assert.ok(src.includes("from '@tauri-apps/api/event'"), 'Should import tauri events');
  });

  it('imports terminalTabsStore', () => {
    assert.ok(src.includes('terminalTabsStore'), 'Should import terminalTabsStore');
  });

  it('imports devServerManager for crash detection', () => {
    assert.ok(src.includes('devServerManager'), 'Should import devServerManager');
    assert.ok(src.includes('dev-server-manager.svelte.js'), 'Should import from dev-server-manager store');
  });
});

describe('Terminal.svelte -- crash detection wiring', () => {
  it('calls devServerManager.handleShellExit on exit event', () => {
    const exitBlock = src.split("case 'exit':")[1]?.split('break')[0] || '';
    assert.ok(exitBlock.includes('devServerManager.handleShellExit(shellId, data.code)'), 'Should call handleShellExit with shellId and exit code');
  });

  it('calls handleShellExit after markExited', () => {
    const exitBlock = src.split("case 'exit':")[1]?.split('break')[0] || '';
    const markIdx = exitBlock.indexOf('markExited');
    const handleIdx = exitBlock.indexOf('handleShellExit');
    assert.ok(markIdx > -1 && handleIdx > -1, 'Should have both calls');
    assert.ok(markIdx < handleIdx, 'markExited should be called before handleShellExit');
  });
});

describe('Terminal.svelte -- props', () => {
  it('accepts shellId prop', () => {
    assert.ok(src.includes('shellId'), 'Should accept shellId prop');
  });

  it('accepts visible prop', () => {
    assert.ok(src.includes('visible'), 'Should accept visible prop');
  });

  it('uses $props()', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });
});

describe('Terminal.svelte -- event handling', () => {
  it('listens to scoped terminal-output-{shellId} event', () => {
    assert.ok(src.includes('`terminal-output-${shellId}`'), 'Should listen to scoped terminal-output-{shellId}');
  });

  it('calls markExited on exit event', () => {
    assert.ok(src.includes('markExited'), 'Should call markExited');
  });

  it('sends input via terminalInput', () => {
    assert.ok(src.includes('terminalInput(shellId'), 'Should call terminalInput with shellId');
  });

  it('sends resize via terminalResize', () => {
    assert.ok(src.includes('terminalResize(shellId'), 'Should call terminalResize with shellId');
  });
});

describe('Terminal.svelte -- terminal setup', () => {
  it('loads the WebGL renderer with DOM fallback on context loss', () => {
    assert.ok(src.includes('new WebglAddon()'), 'Should load WebGL addon');
    assert.ok(src.includes('onContextLoss'), 'Should handle WebGL context loss');
  });

  it('creates Terminal instance', () => {
    assert.ok(src.includes('new Terminal('), 'Should create Terminal');
  });

  it('creates FitAddon', () => {
    assert.ok(src.includes('new FitAddon()'), 'Should create FitAddon');
  });

  it('enables cursor blink for shell', () => {
    assert.ok(src.includes('cursorBlink: true'), 'Should enable cursor blink');
  });

  it('has ResizeObserver', () => {
    assert.ok(src.includes('ResizeObserver'), 'Should observe resize');
  });
});

describe('Terminal.svelte -- toolbar', () => {
  it('has clear button', () => {
    assert.ok(src.includes('handleClear'), 'Should have clear handler');
  });

  it('has copy button', () => {
    assert.ok(src.includes('handleCopy'), 'Should have copy handler');
  });

  it('has paste button', () => {
    assert.ok(src.includes('handlePaste'), 'Should have paste handler');
  });

  it('prevents the browser default paste on Ctrl+V (double-paste guard)', () => {
    const idx = src.indexOf("event.key === 'v'");
    assert.ok(idx > -1, 'Should have a Ctrl+V handler');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('event.preventDefault()'), 'Ctrl+V handler must preventDefault so the native paste event cannot fire a second paste');
  });

  it('routes text pastes through xterm paste pipeline for bracketed paste', () => {
    assert.ok(src.includes('term.paste(text)'), 'handlePaste should use term.paste, not raw PTY input');
  });

  it('uses opaque (pre-blended) selection colors, no alpha channel', () => {
    assert.ok(src.includes('blendHex(bg, accent'), 'Selection should be pre-blended opaque');
    assert.ok(!src.includes("+ '4d'"), 'No alpha-suffixed selection color');
  });

  it('loads the Unicode 11 addon for correct emoji/symbol widths', () => {
    assert.ok(src.includes('new Unicode11Addon()'), 'Should load Unicode11Addon');
    assert.ok(src.includes("unicode.activeVersion = '11'"), 'Should activate Unicode 11 widths');
    // terminal.unicode is a PROPOSED API in xterm 6 — without this flag,
    // loadAddon(unicode11) throws and the whole terminal fails to mount.
    assert.ok(src.includes('allowProposedApi: true'), 'Unicode addon requires allowProposedApi');
  });

  it('sizes via proposeDimensions + resize, never fitAddon.fit()', () => {
    // fit() calls _renderService.clear() before resizing — a one-frame canvas
    // wipe that reads as flicker during window-resize drags.
    assert.ok(src.includes('proposeDimensions()'), 'Should use proposeDimensions');
    assert.ok(!src.includes('fitAddon.fit()'), 'Must not call fitAddon.fit() (clears canvas = flicker)');
  });
});

describe('Terminal.svelte -- visibility', () => {
  it('re-fits on visible change', () => {
    assert.ok(src.includes('if (visible && fitAddon && term)'), 'Should re-fit when visible');
  });
});

describe('Terminal.svelte -- context menu', () => {
  it('has context menu state', () => {
    assert.ok(src.includes('ctxMenu') && src.includes('$state('), 'Should have ctxMenu state');
  });

  it('has handleTerminalContextMenu handler', () => {
    assert.ok(src.includes('function handleTerminalContextMenu'), 'Should have context menu handler');
  });

  it('prevents default on right-click', () => {
    assert.ok(src.includes('event.preventDefault()'), 'Should prevent default context menu');
  });

  it('has oncontextmenu on terminal-view', () => {
    assert.ok(src.includes('oncontextmenu={handleTerminalContextMenu}'), 'Should wire oncontextmenu');
  });

  it('has Copy menu item', () => {
    assert.ok(src.includes('ctxCopy') && src.includes('Copy'), 'Should have Copy item');
  });

  it('has Paste menu item', () => {
    assert.ok(src.includes('ctxPaste') && src.includes('Paste'), 'Should have Paste item');
  });

  it('has Select All menu item', () => {
    assert.ok(src.includes('ctxSelectAll') && src.includes('Select All'), 'Should have Select All item');
  });

  it('has Clear Terminal menu item', () => {
    assert.ok(src.includes('ctxClear') && src.includes('Clear Terminal'), 'Should have Clear Terminal item');
  });

  it('has Find menu item', () => {
    assert.ok(src.includes('ctxFind') && src.includes('Find'), 'Should have Find item');
  });

  it('has Split Right menu item', () => {
    assert.ok(src.includes('ctxSplitRight') && src.includes('Split Right'), 'Should have Split Right item');
  });

  it('has Split Down menu item', () => {
    assert.ok(src.includes('ctxSplitDown') && src.includes('Split Down'), 'Should have Split Down item');
  });

  it('ctxFind toggles search visibility', () => {
    assert.ok(src.includes('searchVisible = true'), 'ctxFind should show search');
  });

  it('ctxSplitRight calls terminalTabsStore.splitInstance horizontal', () => {
    assert.ok(src.includes("ctxSplitRight") && src.includes("'horizontal'"), 'Should split horizontal');
  });

  it('ctxSplitDown calls terminalTabsStore.splitInstance vertical', () => {
    assert.ok(src.includes("ctxSplitDown") && src.includes("'vertical'"), 'Should split vertical');
  });

  it('has handleSelectAll using term.selectAll()', () => {
    assert.ok(src.includes('function handleSelectAll') && src.includes('term.selectAll()'), 'Should have selectAll');
  });

  it('dismisses on Escape key', () => {
    assert.ok(src.includes("e.key === 'Escape'") || src.includes("key === 'Escape'"), 'Should dismiss on Escape');
  });

  it('dismisses on document click', () => {
    assert.ok(src.includes('handleDocumentClick'), 'Should dismiss on outside click');
  });

  it('uses svelte:document for dismiss events', () => {
    assert.ok(src.includes('svelte:document'), 'Should use svelte:document');
  });

  it('has context menu CSS', () => {
    assert.ok(src.includes('.terminal-ctx-menu'), 'Should have context menu styles');
    assert.ok(src.includes('.terminal-ctx-item'), 'Should have menu item styles');
  });

  it('shows shortcut hints', () => {
    assert.ok(src.includes('Ctrl+C') && src.includes('Ctrl+V'), 'Should show shortcut hints');
  });

  it('has separator between groups', () => {
    assert.ok(src.includes('terminal-ctx-separator'), 'Should have separator');
  });
});

describe('Terminal.svelte -- CSS', () => {
  it('has terminal-view class', () => {
    assert.ok(src.includes('terminal-view'), 'Should have view class');
  });

  it('has terminal-container class', () => {
    assert.ok(src.includes('terminal-container'), 'Should have container class');
  });

  it('uses contain strict', () => {
    assert.ok(src.includes('contain: strict'), 'Should use contain strict');
  });
});
