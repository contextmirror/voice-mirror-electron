/**
 * toast.test.js -- Source-inspection tests for tauri/src/lib/stores/toast.svelte.js
 *
 * Since this is a .svelte.js file that uses $state (Svelte 5 runes),
 * it cannot be directly imported in Node.js. We read the source text
 * and assert on expected patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '../../src/lib/stores/toast.svelte.js');
const src = fs.readFileSync(SRC_PATH, 'utf-8');

describe('toast.svelte.js -- constants', () => {
  it('defines MAX_VISIBLE_TOASTS constant', () => {
    assert.ok(src.includes('const MAX_VISIBLE_TOASTS'), 'Should define MAX_VISIBLE_TOASTS');
  });

  it('sets MAX_VISIBLE_TOASTS to 5', () => {
    assert.ok(src.includes('MAX_VISIBLE_TOASTS = 5'), 'MAX_VISIBLE_TOASTS should be 5');
  });

  it('caps the notification center at 100 items', () => {
    assert.ok(src.includes('MAX_ITEMS = 100'), 'MAX_ITEMS should be 100');
  });

  it('defines DEFAULT_DURATION constant', () => {
    assert.ok(src.includes('const DEFAULT_DURATION'), 'Should define DEFAULT_DURATION');
  });

  it('sets DEFAULT_DURATION to 5000', () => {
    assert.ok(src.includes('DEFAULT_DURATION = 5000'), 'DEFAULT_DURATION should be 5000ms');
  });
});

describe('toast.svelte.js -- store export', () => {
  it('exports toastStore', () => {
    assert.ok(src.includes('export const toastStore'), 'Should export toastStore');
  });

  it('creates store via createToastStore factory', () => {
    assert.ok(src.includes('function createToastStore'), 'Should define createToastStore');
    assert.ok(src.includes('createToastStore()'), 'Should call createToastStore');
  });
});

describe('toast.svelte.js -- store methods', () => {
  it('has addToast method', () => {
    assert.ok(src.includes('function addToast'), 'Should have addToast method');
  });

  it('has dismissToast method', () => {
    assert.ok(src.includes('function dismissToast'), 'Should have dismissToast method');
  });

  it('has dismissAll method', () => {
    assert.ok(src.includes('function dismissAll'), 'Should have dismissAll method');
  });

  it('returns addToast, dismissToast, dismissAll in store API', () => {
    assert.ok(src.includes('addToast,'), 'Store should expose addToast');
    assert.ok(src.includes('dismissToast,'), 'Store should expose dismissToast');
    assert.ok(src.includes('dismissAll,'), 'Store should expose dismissAll');
  });

  it('exposes toasts getter', () => {
    assert.ok(
      src.includes('get toasts()'),
      'Store should expose a toasts getter'
    );
  });
});

describe('toast.svelte.js -- Toast object shape', () => {
  it('toast has id field', () => {
    assert.ok(src.includes('id,') || src.includes('id:'), 'Toast should have id');
  });

  it('toast has message field', () => {
    assert.ok(src.includes('message,') || src.includes('message:'), 'Toast should have message');
  });

  it('toast has severity field', () => {
    assert.ok(src.includes('severity'), 'Toast should have severity');
  });

  it('toast has duration field', () => {
    assert.ok(src.includes('duration'), 'Toast should have duration');
  });

  it('toast has createdAt field', () => {
    assert.ok(src.includes('createdAt:'), 'Toast should have createdAt timestamp');
  });

  it('toast has optional action field', () => {
    assert.ok(src.includes('action'), 'Toast should support optional action');
  });

  it('severity defaults to info', () => {
    assert.ok(src.includes("severity = 'info'"), 'severity should default to info');
  });
});

describe('toast.svelte.js -- reactivity', () => {
  it('uses $state for reactivity', () => {
    assert.ok(src.includes('$state('), 'Should use Svelte 5 $state rune');
  });

  it('initializes toasts as empty $state array', () => {
    assert.ok(src.includes('$state([])'), 'Should initialize toasts as $state([])');
  });
});

describe('toast.svelte.js -- auto-dismiss behavior', () => {
  it('has scheduleHide function', () => {
    assert.ok(src.includes('function scheduleHide'), 'Should have scheduleHide');
  });

  it('uses window.setTimeout for auto-dismiss', () => {
    assert.ok(src.includes('window.setTimeout'), 'Should use window.setTimeout');
  });

  it('uses clearTimeout when dismissing', () => {
    assert.ok(src.includes('clearTimeout'), 'Should clear timer on dismiss');
  });

  it('tracks timers with a Map', () => {
    assert.ok(src.includes('new Map()'), 'Should track timers in a Map');
  });
});

describe('toast.svelte.js -- max toast enforcement', () => {
  it('caps the floating stack by visible peeks, not center size', () => {
    assert.ok(
      src.includes('visible.length >= MAX_VISIBLE_TOASTS'),
      'Should enforce the cap on visible toasts only'
    );
  });

  it('hides the oldest visible peek when over limit (item stays in center)', () => {
    assert.ok(
      src.includes('dismissToast(visible[0].id)'),
      'Should hide the oldest visible toast'
    );
  });
});

describe('toast.svelte.js -- uid import', () => {
  it('imports uid from utils', () => {
    assert.ok(
      src.includes("import { uid } from '../utils.js'") ||
      src.includes("import { uid } from '../utils'"),
      'Should import uid from utils module'
    );
  });

  it('uses uid() for toast IDs', () => {
    assert.ok(src.includes('uid()'), 'Should use uid() to generate toast IDs');
  });
});

describe('toast.svelte.js -- multi-action support', () => {
  it('addToast accepts actions parameter', () => {
    assert.ok(src.includes('actions = null'), 'addToast should accept actions param with null default');
  });

  it('includes actions in toast object', () => {
    // The toast object should have an actions field
    assert.ok(src.includes('actions,') || src.includes('actions:'), 'Toast object should include actions');
  });

  it('defines MULTI_ACTION_DURATION constant', () => {
    assert.ok(src.includes('MULTI_ACTION_DURATION'), 'Should define MULTI_ACTION_DURATION');
  });

  it('sets MULTI_ACTION_DURATION to 15000', () => {
    assert.ok(src.includes('MULTI_ACTION_DURATION = 15000'), 'MULTI_ACTION_DURATION should be 15000ms');
  });

  it('uses longer duration when actions provided', () => {
    assert.ok(
      src.includes('actions ? MULTI_ACTION_DURATION : DEFAULT_DURATION'),
      'Should use MULTI_ACTION_DURATION when actions array is provided'
    );
  });

  it('respects explicit duration over multi-action default', () => {
    assert.ok(
      src.includes('duration !== undefined'),
      'Should check if duration was explicitly provided'
    );
  });

  it('backward compat: action (singular) still accepted', () => {
    assert.ok(src.includes('action = null'), 'Should still accept single action param');
    assert.ok(src.includes('action,') || src.includes('action:'), 'Toast should still include action field');
  });
});

describe('toast.svelte.js -- key-based deduplication', () => {
  it('addToast accepts key parameter', () => {
    assert.ok(src.includes('key = null'), 'addToast should accept key param with null default');
  });

  it('includes key in the item object', () => {
    const itemObj = src.split('const item = {')[1]?.split('};')[0] || '';
    assert.ok(itemObj.includes('key'), 'Item object should include key field');
  });

  it('deduplicates by key — the new item replaces the old one entirely', () => {
    assert.ok(
      src.includes("items.find(t => t.key === key)"),
      'Should find existing item by key'
    );
  });

  it('refreshes a still-visible same-key toast in place (no re-pop churn)', () => {
    // Re-raising sources (dev-server detection re-runs) must not churn a
    // visible sticky prompt into a "new" toast that re-animates.
    assert.ok(
      src.includes('existing && existing.toastVisible'),
      'Should detect a still-visible same-key toast'
    );
    assert.ok(
      src.includes('scheduleHide(existing.id, effectiveDuration)'),
      'In-place refresh should reset the hide timer on the SAME id'
    );
  });

  it('replaces a no-longer-visible same-key item entirely (no center pile-up)', () => {
    assert.ok(
      src.includes('removeItem(existing.id)'),
      'Should remove the existing item (toast AND center row) on replace'
    );
  });

  it('respects user dismissal: a ✕-closed key never re-floats this session', () => {
    assert.ok(src.includes('const dismissedKeys = new Set()'), 'Should track user-dismissed keys');
    assert.ok(src.includes('byUser = false'), 'dismissToast should distinguish user vs programmatic hides');
    assert.ok(src.includes('dismissedKeys.has(key)'), 'Re-raises of dismissed keys should stay quiet');
    assert.ok(src.includes('dismissedKeys.delete(item.key)'), 'Acting on the item should lift the suppression');
  });

  it('key dedup only runs when key is provided', () => {
    assert.ok(
      src.includes('if (key)'),
      'Should only deduplicate when key is truthy'
    );
  });

  it('backward compatible — key defaults to null', () => {
    assert.ok(
      src.includes('key = null'),
      'key should default to null for backward compatibility'
    );
  });
});

describe('toast.svelte.js -- progress support', () => {
  it('addToast accepts progress parameter', () => {
    assert.ok(src.includes('progress = null'), 'addToast should accept progress param with null default');
  });

  it('includes progress in the item object', () => {
    const itemObj = src.split('const item = {')[1]?.split('};')[0] || '';
    assert.ok(itemObj.includes('progress'), 'Item object should include progress field');
  });

  it('has updateToast method', () => {
    assert.ok(src.includes('function updateToast'), 'Should have updateToast method');
  });

  it('exposes updateToast in store API', () => {
    assert.ok(src.includes('updateToast,'), 'Store should expose updateToast');
  });

  it('updateToast merges updates into existing toast', () => {
    assert.ok(
      src.includes("t.id === id ? { ...t, ...updates }"),
      'updateToast should merge updates with spread'
    );
  });
});

describe('toast.svelte.js -- center-first: floating is opt-in', () => {
  it('floating requires behavior.floatingToasts === true (errors always float)', () => {
    // Source-of-truth model: without opt-in, only the FLOATING peek is
    // skipped; the notification center still records everything.
    assert.ok(
      src.includes("configStore.value?.behavior?.floatingToasts !== true"),
      'Floating should be opt-in via behavior.floatingToasts'
    );
    assert.ok(
      src.includes("severity !== 'error'"),
      'Errors must float regardless so failures cannot go unnoticed'
    );
    assert.ok(
      src.includes('!panelOpen && !toastsDisabled'),
      'Non-floating items are still added to the center'
    );
  });
});

describe('toast.svelte.js -- severity levels documented', () => {
  it('documents info severity', () => {
    assert.ok(src.includes('info'), 'Should document info severity');
  });

  it('documents success severity', () => {
    assert.ok(src.includes('success'), 'Should document success severity');
  });

  it('documents warning severity', () => {
    assert.ok(src.includes('warning'), 'Should document warning severity');
  });

  it('documents error severity', () => {
    assert.ok(src.includes('error'), 'Should document error severity');
  });
});

describe('toast.svelte.js -- effect-safety (regression: stuck-recording toast froze the UI)', () => {
  // addToast both reads and writes the reactive `toasts` array. Called from an
  // $effect (e.g. App.svelte's voice-stuck toast), an untracked implementation
  // is the only thing preventing an infinite effect loop
  // (effect_update_depth_exceeded) that aborts Svelte's reactivity graph.
  it('imports untrack from svelte', () => {
    assert.ok(
      src.includes("import { untrack } from 'svelte'"),
      'Store must import untrack'
    );
  });

  it('addToast body runs inside untrack', () => {
    assert.ok(
      src.includes('untrack(() => addToastInner(options))'),
      'addToast must wrap its read/write body in untrack'
    );
  });

  it('dismissToast, updateToast and dismissAll are untracked', () => {
    const count = (src.match(/untrack\(\(\) =>/g) || []).length;
    assert.ok(count >= 4, `All four mutators should use untrack (found ${count})`);
  });
});
