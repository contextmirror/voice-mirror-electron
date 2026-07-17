/**
 * shared-components.test.js -- Source-inspection tests for tauri/src/components/shared/
 *
 * Tests Button, Toggle, TextInput, Select, Slider, TitleBar, Toast,
 * ToastContainer, ResizeEdges.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHARED_DIR = path.join(__dirname, '../../../src/components/shared');

function readComponent(name) {
  return fs.readFileSync(path.join(SHARED_DIR, name), 'utf-8');
}

// ---- Button.svelte ----

describe('Button.svelte', () => {
  const src = readComponent('Button.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has variant prop with default secondary', () => {
    assert.ok(src.includes("variant = 'secondary'"), 'Should default variant to secondary');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has onClick prop', () => {
    assert.ok(src.includes('onClick'), 'Should have onClick prop');
  });

  it('has type prop defaulting to button', () => {
    assert.ok(src.includes("type = 'button'"), 'Should default type to button');
  });

  it('has small prop for compact variant', () => {
    assert.ok(src.includes('small'), 'Should have small prop');
  });

  it('has children prop for slot content', () => {
    assert.ok(src.includes('children'), 'Should accept children');
    assert.ok(src.includes('{@render children()}'), 'Should render children');
  });

  it('has primary variant CSS', () => {
    assert.ok(src.includes('.btn-primary'), 'Should have primary variant CSS');
  });

  it('has secondary variant CSS', () => {
    assert.ok(src.includes('.btn-secondary'), 'Should have secondary variant CSS');
  });

  it('has danger variant CSS', () => {
    assert.ok(src.includes('.btn-danger'), 'Should have danger variant CSS');
  });

  it('has small variant CSS', () => {
    assert.ok(src.includes('.btn.small'), 'Should have small variant CSS');
  });

  it('has focus-visible outline', () => {
    assert.ok(src.includes(':focus-visible'), 'Should have focus-visible styles');
  });

  it('styles disabled state', () => {
    assert.ok(src.includes(':disabled'), 'Should style disabled state');
  });
});

// ---- Toggle.svelte ----

describe('Toggle.svelte', () => {
  const src = readComponent('Toggle.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has checked prop', () => {
    assert.ok(src.includes('checked'), 'Should have checked prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has description prop', () => {
    assert.ok(src.includes("description = ''"), 'Should have description prop');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has checkbox input element', () => {
    assert.ok(src.includes('type="checkbox"'), 'Should use checkbox input');
  });

  it('has toggle-switch CSS', () => {
    assert.ok(src.includes('.toggle-switch'), 'Should have toggle-switch CSS');
  });

  it('has toggle-track CSS', () => {
    assert.ok(src.includes('.toggle-track'), 'Should have toggle-track CSS');
  });

  it('has toggle-label-group for label and description', () => {
    assert.ok(src.includes('toggle-label-group'), 'Should group label and description');
  });

  it('has focus-visible support on input', () => {
    assert.ok(src.includes('focus-visible'), 'Should have focus-visible styles');
  });

  it('fires onChange with new checked value', () => {
    assert.ok(src.includes('onChange(e.target.checked)'), 'Should fire onChange with value');
  });
});

// ---- TextInput.svelte ----

describe('TextInput.svelte', () => {
  const src = readComponent('TextInput.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value prop', () => {
    assert.ok(src.includes("value = ''"), 'Should have value prop');
  });

  it('has placeholder prop', () => {
    assert.ok(src.includes("placeholder = ''"), 'Should have placeholder prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has type prop supporting text/password/url/email', () => {
    assert.ok(src.includes("type = 'text'"), 'Should default type to text');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has readonly prop', () => {
    assert.ok(src.includes('readonly'), 'Should have readonly prop');
  });

  it('has input element', () => {
    assert.ok(src.includes('<input'), 'Should have input element');
  });

  it('has label element with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with input');
  });

  it('derives inputId from label text', () => {
    assert.ok(src.includes('inputId'), 'Should derive inputId');
  });

  it('has text-input CSS class', () => {
    assert.ok(src.includes('.text-input'), 'Should have text-input CSS');
  });
});

// ---- Select.svelte ----

describe('Select.svelte', () => {
  const src = readComponent('Select.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value prop', () => {
    assert.ok(src.includes("value = ''"), 'Should have value prop');
  });

  it('has options prop', () => {
    assert.ok(src.includes('options = []'), 'Should have options prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has disabled prop', () => {
    assert.ok(src.includes('disabled'), 'Should have disabled prop');
  });

  it('has select element', () => {
    assert.ok(src.includes('<select'), 'Should have select element');
  });

  it('renders option elements', () => {
    assert.ok(src.includes('<option'), 'Should render option elements');
  });

  it('supports grouped options with optgroup', () => {
    assert.ok(src.includes('<optgroup'), 'Should support optgroup');
  });

  it('derives grouped options from group field', () => {
    assert.ok(src.includes('grouped'), 'Should derive grouped options');
  });

  it('has label element with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with select');
  });

  it('has select-input CSS class', () => {
    assert.ok(src.includes('.select-input'), 'Should have select-input CSS');
  });
});

// ---- Slider.svelte ----

describe('Slider.svelte', () => {
  const src = readComponent('Slider.svelte');

  it('uses $props', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
  });

  it('has value, min, max, step props', () => {
    assert.ok(src.includes('value = 0'), 'Should have value prop');
    assert.ok(src.includes('min = 0'), 'Should have min prop');
    assert.ok(src.includes('max = 100'), 'Should have max prop');
    assert.ok(src.includes('step = 1'), 'Should have step prop');
  });

  it('has onChange prop', () => {
    assert.ok(src.includes('onChange'), 'Should have onChange prop');
  });

  it('has label prop', () => {
    assert.ok(src.includes("label = ''"), 'Should have label prop');
  });

  it('has formatValue prop', () => {
    assert.ok(src.includes('formatValue'), 'Should have formatValue prop');
  });

  it('has range input element', () => {
    assert.ok(src.includes('type="range"'), 'Should have range input');
  });

  it('displays formatted value', () => {
    assert.ok(src.includes('displayValue'), 'Should derive displayValue');
    assert.ok(src.includes('slider-value'), 'Should show slider value');
  });

  it('has slider-input CSS class', () => {
    assert.ok(src.includes('.slider-input'), 'Should have slider-input CSS');
  });

  it('has label with for attribute', () => {
    assert.ok(src.includes('<label'), 'Should have label element');
    assert.ok(src.includes('for={inputId}'), 'Should associate label with input');
  });

  it('parses input value as float', () => {
    assert.ok(src.includes('parseFloat'), 'Should parse as float');
  });
});

// ---- TitleBar.svelte ----

describe('TitleBar.svelte', () => {
  const src = readComponent('TitleBar.svelte');

  it('imports overlayStore for compact mode', () => {
    assert.ok(src.includes('overlayStore'), 'Should import overlayStore');
  });

  it('uses native decorum controls for window buttons', () => {
    assert.ok(src.includes('data-tauri-decorum-tb'), 'Should use decorum native controls');
    assert.ok(src.includes('decorum-controls'), 'Should have decorum-controls class');
  });

  it('has compact/orb button with aria-label', () => {
    assert.ok(src.includes('Collapse to orb'), 'Should have compact button label');
  });

  it('has window-controls section', () => {
    assert.ok(src.includes('window-controls'), 'Should have window-controls section');
  });

  it('has titlebar CSS class', () => {
    assert.ok(src.includes('.titlebar'), 'Should have titlebar CSS');
  });

  it('imports navigationStore', () => {
    assert.ok(src.includes('navigationStore'), 'Should import navigationStore');
  });

  it('no longer has the Mirror/Lens mode toggle (Mirror mode removed)', () => {
    assert.ok(!src.includes('mode-toggle'), 'Mode toggle should be gone');
    assert.ok(!src.includes('>Mirror<'), 'Mirror button should be gone');
    assert.ok(!src.includes('handleModeSwitch'), 'handleModeSwitch should be gone');
  });

  it('has data-tauri-drag-region for dragging', () => {
    assert.ok(src.includes('data-tauri-drag-region'), 'Should have drag region attribute');
  });

  it('has win-compact CSS class', () => {
    assert.ok(src.includes('.win-compact'), 'Should have compact button CSS');
  });

  it('styles native decorum buttons to match titlebar height', () => {
    assert.ok(src.includes('decorum-tb-btn') || src.includes('decorum-tb-minimize'), 'Should style native buttons');
  });

  it('accepts centerContent snippet prop', () => {
    assert.ok(src.includes('centerContent'), 'Should accept centerContent snippet');
  });

  it('has titlebar-center for injected content', () => {
    assert.ok(src.includes('titlebar-center'), 'Should have titlebar-center div');
  });

  it('renders centerContent with @render', () => {
    assert.ok(src.includes('{@render centerContent()}'), 'Should render centerContent snippet');
  });
});

// ---- Toast.svelte ----

describe('Toast.svelte', () => {
  const src = readComponent('Toast.svelte');

  it('uses $props for toast and onDismiss', () => {
    assert.ok(src.includes('$props()'), 'Should use $props');
    assert.ok(src.includes('toast'), 'Should accept toast prop');
    assert.ok(src.includes('onDismiss'), 'Should accept onDismiss prop');
  });

  it('has role="alert" for accessibility', () => {
    assert.ok(src.includes('role="alert"'), 'Should have alert role');
  });

  it('has aria-live="polite"', () => {
    assert.ok(src.includes('aria-live="polite"'), 'Should have polite aria-live');
  });

  it('has dismiss button with aria-label', () => {
    assert.ok(src.includes('aria-label="Dismiss notification"'), 'Should have dismiss aria-label');
  });

  it('supports severity: info, success, warning, error', () => {
    assert.ok(src.includes('.toast.info'), 'Should have info style');
    assert.ok(src.includes('.toast.success'), 'Should have success style');
    assert.ok(src.includes('.toast.warning'), 'Should have warning style');
    assert.ok(src.includes('.toast.error'), 'Should have error style');
  });

  it('carries severity on a tinted icon chip using theme tokens', () => {
    assert.ok(src.includes('var(--warn-subtle)'), 'Warning chip should use --warn-subtle');
    assert.ok(src.includes('var(--ok-subtle)'), 'Success chip should use --ok-subtle');
    assert.ok(src.includes('var(--danger-subtle)'), 'Error chip should use --danger-subtle');
    assert.ok(src.includes('var(--accent-subtle)'), 'Info chip should use --accent-subtle');
    assert.ok(!src.includes('border-left:'), 'Severity border replaced by the icon chip');
  });

  it('uses a frosted theme-derived surface', () => {
    assert.ok(src.includes('color-mix'), 'Background should blend --bg-elevated with transparency');
    assert.ok(src.includes('backdrop-filter'), 'Should blur what is behind the capsule');
  });

  it('has severity-based SVG icons', () => {
    assert.ok(src.includes("<svg viewBox="), 'Should have SVG icons per severity');
  });

  it('shows toast.message text', () => {
    assert.ok(src.includes('{toast.message}'), 'Should display toast message');
  });

  it('supports optional action button', () => {
    assert.ok(src.includes('toast.action'), 'Should check for action');
    assert.ok(src.includes('toast-action'), 'Should have action button CSS');
  });

  it('pops out of the bottom-right corner on enter and tucks back on exit', () => {
    assert.ok(src.includes('in:capsuleIn'), 'Should use the pop-out transition');
    assert.ok(src.includes('out:capsuleOut'), 'Should use the tuck-away transition');
    assert.ok(src.includes('backOut'), 'Entrance should pop with a slight overshoot');
    assert.ok(src.includes('transform-origin: bottom right'), 'Motion should originate from the bell corner');
  });

  it('respects prefers-reduced-motion in both transitions', () => {
    assert.ok(src.includes('prefersReducedMotion'), 'Transitions should check reduced-motion');
    assert.ok(src.includes('prefers-reduced-motion: reduce'), 'Should query the media feature');
  });

  it('renders single action and actions array through one inline pill row', () => {
    assert.ok(src.includes('actionList'), 'Should merge action/actions into one list');
    assert.ok(src.includes('toast.actions'), 'Should support the actions array');
    assert.ok(src.includes("class:primary={i === 0}"), 'First action should be the filled primary pill');
  });

  it('renders progress bar when toast.progress is present', () => {
    assert.ok(src.includes('toast.progress != null'), 'Should check for progress field');
    assert.ok(src.includes('toast-progress-track'), 'Should have progress track class');
    assert.ok(src.includes('toast-progress-bar'), 'Should have progress bar class');
  });

  it('progress bar has correct ARIA attributes', () => {
    assert.ok(src.includes('role="progressbar"'), 'Should have progressbar role');
    assert.ok(src.includes('aria-valuenow'), 'Should have aria-valuenow');
    assert.ok(src.includes('aria-valuemin="0"'), 'Should have aria-valuemin');
    assert.ok(src.includes('aria-valuemax="100"'), 'Should have aria-valuemax');
  });

  it('progress bar uses accent color', () => {
    assert.ok(src.includes('.toast-progress-bar'), 'Should style progress bar');
    assert.ok(src.includes('var(--accent)'), 'Progress bar should use accent color');
  });
});

// ---- ToastContainer.svelte ----

describe('ToastContainer.svelte', () => {
  const src = readComponent('ToastContainer.svelte');

  it('imports toastStore', () => {
    assert.ok(src.includes("import { toastStore }"), 'Should import toastStore');
  });

  it('imports Toast component', () => {
    assert.ok(src.includes("import Toast from './Toast.svelte'"), 'Should import Toast');
  });

  it('has toast-container CSS class', () => {
    assert.ok(src.includes('.toast-container'), 'Should have toast-container CSS');
  });

  it('is fixed positioned at bottom-right, by the status-bar bell', () => {
    assert.ok(src.includes('position: fixed'), 'Should be fixed positioned');
    assert.ok(src.includes('bottom:'), 'Should be at bottom');
    assert.ok(src.includes('right: 12px'), 'Should be anchored to the right edge');
    assert.ok(src.includes('align-items: flex-end'), 'Stack should right-align above the bell');
  });

  it('has z-index: 10002 (above orb)', () => {
    assert.ok(src.includes('z-index: 10002'), 'Should have z-index above orb');
  });

  it('has aria-live="polite"', () => {
    assert.ok(src.includes('aria-live="polite"'), 'Should have aria-live');
  });

  it('has aria-label="Notifications"', () => {
    assert.ok(src.includes('aria-label="Notifications"'), 'Should have aria-label');
  });

  it('renders store order so the newest toast lands nearest the status bar', () => {
    assert.ok(src.includes('toastStore.toasts as toast'), 'Should iterate store order directly');
    assert.ok(!src.includes('.reverse()'), 'No reversal — newest belongs at the bottom of the stack');
  });

  it('reflows the stack smoothly when a toast leaves', () => {
    assert.ok(src.includes("import { flip } from 'svelte/animate'"), 'Should import flip');
    assert.ok(src.includes('animate:flip'), 'Each toast slot should animate position changes');
  });

  it('owns its styling exclusively — no global .toast rules may exist', () => {
    // A legacy global .toast/.toast-container block in notifications.css once
    // leaked left/transform/padding into the scoped component and dragged the
    // stack away from its right anchor. Guard against reintroduction.
    const cssPath = path.join(__dirname, '..', '..', '..', 'src', 'styles', 'notifications.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(!/^\s*\.toast[\s.{,:-]/m.test(css), 'notifications.css must not style .toast* classes');
  });

  it('floats above the status bar', () => {
    assert.ok(src.includes('bottom: 40px'), 'Should clear the 22px status bar with breathing room');
  });

  it('renders Toast for each toast', () => {
    assert.ok(src.includes('<Toast'), 'Should render Toast component');
  });

  it('handles dismiss via toastStore.dismissToast', () => {
    assert.ok(src.includes('toastStore.dismissToast'), 'Should dismiss via store');
  });
});

// ---- ResizeEdges.svelte ----

describe('ResizeEdges.svelte', () => {
  const src = readComponent('ResizeEdges.svelte');

  it('imports getCurrentWindow from tauri', () => {
    assert.ok(src.includes("from '@tauri-apps/api/window'"));
  });

  it('calls startResizeDragging', () => {
    assert.ok(src.includes('startResizeDragging'));
  });

  it('has all four edge directions', () => {
    for (const dir of ['North', 'South', 'East', 'West']) {
      assert.ok(src.includes(`'${dir}'`), `Should have ${dir} direction`);
    }
  });

  it('has all four corner directions', () => {
    for (const dir of ['NorthWest', 'NorthEast', 'SouthWest', 'SouthEast']) {
      assert.ok(src.includes(`'${dir}'`), `Should have ${dir} direction`);
    }
  });

  it('has resize-edge CSS class', () => {
    assert.ok(src.includes('.resize-edge'));
  });

  it('has resize-corner CSS class', () => {
    assert.ok(src.includes('.resize-corner'));
  });

  it('uses high z-index to stay above content', () => {
    assert.ok(src.includes('z-index: 99999'));
  });

  it('uses no-drag for frameless window', () => {
    assert.ok(src.includes('-webkit-app-region: no-drag'));
  });

  it('uses position fixed', () => {
    assert.ok(src.includes('position: fixed'));
  });
});
