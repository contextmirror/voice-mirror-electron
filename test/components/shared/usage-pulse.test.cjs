/**
 * usage-pulse.test.cjs -- Source-inspection tests for the native usage pulse.
 *
 * Covers the UsagePulse strip component, its mounting in StatusBar, and the
 * diagnostics/health wiring for the `usage-pulse` subsystem.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../..', p), 'utf-8');

const pulse = read('src/components/shared/UsagePulse.svelte');
const statusBar = read('src/components/shared/StatusBar.svelte');
const health = read('src/lib/health-contracts.js');
const diagnostics = read('src/lib/stores/diagnostics.svelte.js');

describe('UsagePulse.svelte: data source', () => {
  it('reads aiStatusStore.usage', () => {
    assert.ok(pulse.includes('aiStatusStore.usage'), 'Should read usage from the store');
  });

  it('only shows for a running CLI provider with a snapshot', () => {
    assert.ok(pulse.includes('isCliProvider'), 'Should gate on isCliProvider');
    assert.ok(/const show\s*=\s*\$derived/.test(pulse), 'Should derive a show flag');
  });
});

describe('UsagePulse.svelte: full-parity fields', () => {
  it('renders the session (five-hour) limit', () => {
    assert.ok(pulse.includes('fiveHour'), 'Should render fiveHour session limit');
    assert.ok(pulse.includes('Session'), 'Should label Session');
  });

  it('renders the weekly (seven-day) limit with a reset time', () => {
    assert.ok(pulse.includes('sevenDay'), 'Should render sevenDay weekly limit');
    assert.ok(pulse.includes('Weekly'), 'Should label Weekly');
    assert.ok(pulse.includes('formatReset'), 'Should format reset time');
    assert.ok(pulse.includes('R:'), 'Should show R: reset prefix like the terminal');
  });

  it('renders context usage', () => {
    assert.ok(pulse.includes('contextPct'), 'Should render context percentage');
    assert.ok(pulse.includes('Context'), 'Should label Context');
  });

  it('renders session cost, converted to the local currency', () => {
    assert.ok(pulse.includes('costUsd'), 'Should render cost');
    assert.ok(pulse.includes('formatCost'), 'Should format via the currency helper');
    assert.ok(pulse.includes('getUsdConversion'), 'Should fetch a USD conversion');
    assert.ok(pulse.includes('detectCurrency'), 'Should detect the local currency');
  });

  it('renders the model name', () => {
    assert.ok(pulse.includes('usage.model'), 'Should render the model name');
  });

  it('renders a peak-window indicator (weekday 1pm-7pm)', () => {
    assert.ok(pulse.includes('PEAK_START') && pulse.includes('PEAK_END'), 'Should define peak window');
    assert.ok(pulse.includes('Off-Peak') && pulse.includes('In Peak'), 'Should show peak states');
  });

  it('gracefully hides rate bars when hasRateLimits is false (older Claude Code)', () => {
    assert.ok(pulse.includes('hasRateLimits'), 'Should gate rate bars on hasRateLimits');
  });
});

describe('UsagePulse.svelte: bars colour-code by usage band', () => {
  it('has a level() helper with ok/warn/danger bands', () => {
    assert.ok(pulse.includes('function level('), 'Should have a level() helper');
    assert.ok(pulse.includes('lvl-ok') && pulse.includes('lvl-warn') && pulse.includes('lvl-danger'),
      'Should map to ok/warn/danger classes');
  });

  it('uses theme colour variables for the bands', () => {
    assert.ok(pulse.includes('var(--ok') && pulse.includes('var(--warn') && pulse.includes('var(--danger'),
      'Should use --ok/--warn/--danger theme vars');
  });

  it('ticks on an interval so the peak window stays fresh', () => {
    assert.ok(pulse.includes('setInterval'), 'Should refresh via setInterval');
    assert.ok(pulse.includes('clearInterval'), 'Should clean up the interval');
  });
});

describe('StatusBar.svelte: mounts the usage strip', () => {
  it('imports UsagePulse', () => {
    assert.ok(statusBar.includes("import UsagePulse from './UsagePulse.svelte'"), 'Should import UsagePulse');
  });

  it('renders <UsagePulse /> in the center section', () => {
    assert.ok(statusBar.includes('<UsagePulse'), 'Should render UsagePulse');
  });
});

describe('usage-pulse: diagnostics + health wiring', () => {
  it('registers a usage-pulse health contract', () => {
    assert.ok(health.includes("name: 'usage-pulse'"), 'Should register usage-pulse contract');
  });

  it('the contract guards the store wiring (usage field present)', () => {
    assert.ok(health.includes("'usage' in aiStatusStore"), 'Should guard aiStatusStore.usage presence');
  });

  it('registers usage-pulse in EXPECTED_SUBSYSTEMS', () => {
    assert.ok(diagnostics.includes("'usage-pulse'"), 'Should list usage-pulse as an expected subsystem');
  });
});
