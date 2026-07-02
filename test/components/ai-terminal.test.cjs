/**
 * ai-terminal.test.cjs
 *
 * Guards the cold-start terminal sizing fix: on first boot into the Lens IDE,
 * the terminal canvas must wait for the monospace web font before its initial
 * fit, or it leaves a grey band until a resize/remount.
 *
 * Also guards the Ctrl+V double-paste fix: xterm.js listens for the browser's
 * native `paste` event, so the custom Ctrl+V handler must preventDefault or
 * every paste reaches the PTY twice.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'terminal', 'AiTerminal.svelte'),
  'utf-8'
);

describe('AiTerminal: paste handling', () => {
  it('prevents the browser default paste on Ctrl+V (double-paste guard)', () => {
    const idx = src.indexOf("event.key === 'v'");
    assert.ok(idx > -1, 'Should have a Ctrl+V handler');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('event.preventDefault()'), 'Ctrl+V handler must preventDefault so the native paste event cannot fire a second paste');
    assert.ok(block.includes('handlePaste()'), 'Ctrl+V handler should call handlePaste');
  });

  it('routes text pastes through xterm paste pipeline for bracketed paste', () => {
    assert.ok(src.includes('term.paste(text)'), 'handlePaste should use term.paste, not raw PTY input');
  });
});

describe('AiTerminal: cursor visibility', () => {
  it('never hides the cursor by painting it in the background color', () => {
    // Claude Code positions the REAL terminal cursor (it does not draw its
    // own) — the old ghostty-era hack of cursor=bg left users cursorless.
    assert.ok(!src.includes("providerType === 'claude' ? bg"), 'Cursor color must not be provider-conditional');
    assert.ok(src.includes('cursor: accent'), 'Cursor should use the visible accent color');
  });

  it('keeps cursorBlink unconditional and restores it after TUI exit', () => {
    assert.ok(src.includes('cursorBlink: true'), 'cursorBlink should be on for all providers');
    // xtermjs/xterm.js#5314: TUIs clobber cursorBlink via DECSET/DECRST 12 and
    // xterm 6.0.0 never restores it — we re-assert on provider exit.
    // (Don't cut at the first `break` — the exit case starts with an
    // early-exit guard `if (isSwitching) break;` before the restore line.)
    const exitBlock = src.split("case 'exit':")[1]?.slice(0, 1500) || '';
    assert.ok(exitBlock.includes('cursorBlink = true'), 'Exit handler should restore cursorBlink');
  });
});

describe('AiTerminal: rendering fidelity', () => {
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
});

describe('AiTerminal: flicker-free resize', () => {
  it('sizes via proposeDimensions + resize, never fitAddon.fit()', () => {
    // fit() calls _renderService.clear() before resizing — a one-frame canvas
    // wipe that reads as flicker during window-resize drags.
    assert.ok(src.includes('proposeDimensions()'), 'Should use proposeDimensions');
    assert.ok(!src.includes('fitAddon.fit()'), 'Must not call fitAddon.fit() (clears canvas = flicker)');
  });
});

describe('AiTerminal: cold-start sizing', () => {
  it('waits for web fonts before the initial fit', () => {
    assert.ok(src.includes('document.fonts.ready'), 'Should await document.fonts.ready before fitting');
  });

  it('still fits and reveals the terminal after fonts load', () => {
    const idx = src.indexOf('document.fonts.ready');
    const after = src.slice(idx);
    assert.ok(after.includes('fitTerminal()'), 'Should fit after fonts are ready');
    assert.ok(after.includes('initialized = true'), 'Should reveal (initialized) after the corrected fit');
  });
});
