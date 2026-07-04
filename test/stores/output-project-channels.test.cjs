const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, '../../src/lib/stores/output.svelte.js');
const src = fs.readFileSync(STORE_PATH, 'utf-8');

describe('output.svelte.js -- project channels', () => {
  it('has SYSTEM_CHANNELS constant', () => {
    assert.ok(src.includes('SYSTEM_CHANNELS'), 'Should have SYSTEM_CHANNELS');
  });

  it('has projectChannelEntries state', () => {
    assert.ok(src.includes('projectChannelEntries'), 'Should track project channel entries');
  });

  it('has projectChannelList state', () => {
    assert.ok(src.includes('projectChannelList'), 'Should track project channel list');
  });

  it('listens for project-output-log event', () => {
    assert.ok(src.includes("'project-output-log'"), 'Should listen for project-output-log');
  });

  it('listens for the BATCHED project-output-log-batch event (flood coalescing)', () => {
    // A noisy dev server fires hundreds of lines/sec; the Rust side coalesces
    // them into one event so the main-thread tauri event loop isn't flooded
    // (feeds the "Not Responding" WndProc stall, tauri#14750). The store must
    // handle the batch shape { channel, entries[] }.
    assert.ok(src.includes("'project-output-log-batch'"), 'Should listen for the batch event');
    assert.ok(src.includes('appendProjectEntries'), 'Should append via the shared batched helper');
  });

  it('listens for lens-console-message event', () => {
    assert.ok(src.includes("'lens-console-message'"), 'Should listen for lens-console-message');
  });

  it('exports registerProjectChannel method', () => {
    assert.ok(src.includes('registerProjectChannel'), 'Should have registerProjectChannel');
  });

  it('exports unregisterProjectChannel method', () => {
    assert.ok(src.includes('unregisterProjectChannel'), 'Should have unregisterProjectChannel');
  });

  it('exports projectChannels getter', () => {
    assert.ok(src.includes('projectChannels'), 'Should export projectChannels');
  });

  it('exports hasProjectErrors getter', () => {
    assert.ok(src.includes('hasProjectErrors'), 'Should export hasProjectErrors');
  });

  it('handles switchChannel for project channels', () => {
    assert.ok(src.includes('projectChannelEntries[ch]') || src.includes('projectChannelEntries[activeChannel]'),
      'switchChannel should accept project channels');
  });

  it('imports apiRegister and apiUnregister from api.js', () => {
    assert.ok(src.includes('registerProjectChannel as apiRegister'), 'Should import registerProjectChannel as apiRegister');
    assert.ok(src.includes('unregisterProjectChannel as apiUnregister'), 'Should import unregisterProjectChannel as apiUnregister');
  });

  it('getFilteredEntries checks project channels', () => {
    assert.ok(src.includes('projectChannelEntries[activeChannel]'), 'getFilteredEntries should fall back to project channel entries');
  });

  it('clearChannel handles project channels', () => {
    // clearChannel should check both system entries and project entries
    assert.ok(src.includes('projectChannelEntries[activeChannel]'), 'clearChannel should handle project channel entries');
  });

  it('unregister switches to app channel if viewing removed channel', () => {
    assert.ok(src.includes("activeChannel = 'app'"), 'Should switch to app when active project channel is removed');
  });

  it('caps project channel entries at MAX_ENTRIES', () => {
    // Both project-output-log and lens-console-message handlers should cap entries
    const matches = src.match(/arr\.length > MAX_ENTRIES/g);
    assert.ok(matches && matches.length >= 3, 'Should cap entries in at least 3 places (system + 2 project listeners)');
  });
});

describe('output.svelte.js -- console message routing', () => {
  it('routes lens-console-message to the ACTIVE project channel', () => {
    assert.ok(src.includes("import { projectStore } from './project.svelte.js'"), 'imports projectStore');
    const start = src.indexOf("listen('lens-console-message'");
    assert.ok(start !== -1, 'lens-console-message listener exists');
    const chunk = src.slice(start, start + 1800);
    assert.ok(chunk.includes('projectStore.root'), 'reads the active project root');
    assert.ok(chunk.includes('c.projectPath === activeRoot'), 'matches the channel by project path');
  });

  it('falls back to the first registered channel when the active project has none', () => {
    const start = src.indexOf("listen('lens-console-message'");
    const chunk = src.slice(start, start + 1800);
    assert.ok(chunk.includes('|| projectChannelList[0]'), 'keeps the first-channel fallback');
  });

  it('drops the first-channel-only TODO', () => {
    assert.ok(!src.includes('TODO: route based on URL/port'), 'TODO resolved');
  });
});
