/**
 * toast.svelte.js -- Unified notification store (Svelte 5 runes).
 *
 * THE notification center's source of truth. Every notification is one item
 * in `items`; a floating toast is just that item's transient "peek" state
 * (`toastVisible`). When a toast times out or is dismissed it stays in the
 * notification center — with its action buttons still clickable — until the
 * user resolves, dismisses, or clears it there.
 *
 * Surfaces:
 *  - ToastContainer renders `toasts` (visible peeks, suppressed entirely
 *    while the notification panel is open — new items land in the panel).
 *  - The status bar bell renders `notifications` (all items, newest first)
 *    and `unreadCount`.
 *
 * Severity levels: info, success, warning, error.
 */

import { untrack } from 'svelte';
import { uid } from '../utils.js';
import { configStore } from './config.svelte.js';

/**
 * @typedef {Object} NotificationItem
 * @property {string} id - Unique ID
 * @property {string} message - Message text
 * @property {'info'|'success'|'warning'|'error'} severity - Visual style
 * @property {number} duration - Toast auto-hide duration in ms (0 = sticky)
 * @property {{ label: string, callback: () => void }|null} action - Optional action button
 * @property {Array<{ label: string, callback: () => void }>|null} actions - Optional multiple action buttons
 * @property {string|null} key - Deduplication key (same key replaces the item)
 * @property {number|null} progress - Progress bar value 0-100, null for no bar
 * @property {string|null} source - Originating subsystem, for grouping/debugging
 * @property {number} createdAt - Creation timestamp
 * @property {boolean} read - Seen in the notification panel
 * @property {boolean} toastVisible - Currently floating as a toast
 */

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE_TOASTS = 5;
const MAX_ITEMS = 100;

/** Duration for toasts with multiple actions (gives user time to read and click) */
const MULTI_ACTION_DURATION = 15000;

function createToastStore() {
  /** @type {NotificationItem[]} insertion order, oldest first */
  let items = $state([]);

  /** Notification panel (status-bar bell) open state — shared so the
   *  floating toast stack can suppress itself while the panel is showing. */
  let panelOpen = $state(false);

  /** @type {Map<string, number>} Active toast-hide timers */
  const timers = new Map();

  function clearTimer(id) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  /** Hide a toast peek after its duration; the item stays in the center. */
  function scheduleHide(id, duration) {
    if (duration <= 0) return;
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, duration);
    timers.set(id, timer);
  }

  /**
   * Add a notification. It always lands in the notification center; it also
   * floats as a toast unless the panel is open (then it arrives in the
   * panel directly, already read) or non-error toasts are disabled in
   * behavior settings (then it lands unread, silently).
   *
   * Wrapped in `untrack`: this both reads and writes `items` (key dedup +
   * push), so a caller inside an `$effect` would otherwise register `items`
   * as a dependency of that effect and re-run itself on every add — an
   * infinite loop (effect_update_depth_exceeded) that kills the whole
   * reactivity graph. Store mutators must never leak deps into callers.
   *
   * @param {{ message: string, severity?: string, duration?: number, action?: { label: string, callback: () => void }|null, actions?: Array<{ label: string, callback: () => void }>|null, key?: string|null, progress?: number|null, source?: string|null }} options
   * @returns {string} The notification ID
   */
  function addToast(options) {
    return untrack(() => addToastInner(options));
  }

  function addToastInner({
    message,
    severity = 'info',
    duration,
    action = null,
    actions = null,
    key = null,
    progress = null,
    source = null,
  }) {
    // Deduplicate by key — the new item replaces the old one entirely
    // (center row included), so re-prompts never pile up in history.
    if (key) {
      const existing = items.find(t => t.key === key);
      if (existing) removeItem(existing.id);
    }

    const toastsDisabled =
      severity !== 'error' && configStore.value?.behavior?.showToasts === false;

    // Use longer duration for multi-action toasts unless explicitly set
    const effectiveDuration = duration !== undefined
      ? duration
      : (actions ? MULTI_ACTION_DURATION : DEFAULT_DURATION);

    const id = uid();
    const item = {
      id,
      message,
      severity,
      duration: effectiveDuration,
      action,
      actions,
      key,
      progress,
      source,
      createdAt: Date.now(),
      // Arriving while the panel is open counts as seen.
      read: panelOpen,
      toastVisible: !panelOpen && !toastsDisabled,
    };

    // Cap the floating stack: hide the oldest visible peek, keep its item.
    if (item.toastVisible) {
      const visible = items.filter(t => t.toastVisible);
      if (visible.length >= MAX_VISIBLE_TOASTS) {
        dismissToast(visible[0].id);
      }
    }

    // Trim the center history if over max (oldest first)
    let updated = [...items, item];
    if (updated.length > MAX_ITEMS) {
      for (const dropped of updated.slice(0, updated.length - MAX_ITEMS)) {
        clearTimer(dropped.id);
      }
      updated = updated.slice(updated.length - MAX_ITEMS);
    }
    items = updated;

    if (item.toastVisible) scheduleHide(id, effectiveDuration);
    return id;
  }

  /**
   * Hide a toast peek. The item STAYS in the notification center, unread,
   * with its actions intact. Untracked — safe to call from effects.
   * @param {string} id
   */
  function dismissToast(id) {
    untrack(() => {
      clearTimer(id);
      items = items.map(t => t.id === id ? { ...t, toastVisible: false } : t);
    });
  }

  /**
   * Resolve an item: an action was clicked (from the toast or the panel),
   * so the notification is dealt with and leaves the center entirely.
   * @param {string} id
   */
  function resolveItem(id) {
    removeItem(id);
  }

  /**
   * Remove an item from the center (and its toast peek, if floating).
   * Untracked — safe to call from effects.
   * @param {string} id
   */
  function removeItem(id) {
    untrack(() => {
      clearTimer(id);
      items = items.filter(t => t.id !== id);
    });
  }

  /**
   * Remove an item by its dedup key (no-op if none). For retiring
   * context-bound notifications (e.g. a project's consent prompt when the
   * user switches away from that project) — stale context shouldn't linger
   * in history either. Untracked — safe to call from effects.
   * @param {string} key
   */
  function dismissByKey(key) {
    untrack(() => {
      const existing = items.find(t => t.key === key);
      if (existing) removeItem(existing.id);
    });
  }

  /**
   * Update an existing item's properties (e.g., message, progress).
   * Untracked — safe to call from effects.
   * @param {string} id - Notification ID to update
   * @param {Partial<NotificationItem>} updates - Properties to merge
   */
  function updateToast(id, updates) {
    untrack(() => {
      items = items.map(t => t.id === id ? { ...t, ...updates } : t);
    });
  }

  /**
   * Hide all floating toast peeks (items stay in the center).
   * Untracked — safe to call from effects.
   */
  function dismissAll() {
    untrack(() => {
      for (const [, timer] of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      items = items.map(t => t.toastVisible ? { ...t, toastVisible: false } : t);
    });
  }

  /** Empty the notification center entirely. */
  function clearAll() {
    untrack(() => {
      for (const [, timer] of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      items = [];
    });
  }

  /** Mark every item as read (bell badge resets). */
  function markAllRead() {
    untrack(() => {
      items = items.map(t => t.read ? t : { ...t, read: true });
    });
  }

  /**
   * Open/close the notification panel. Opening marks everything read and
   * suppresses the floating stack (new arrivals land in the panel).
   * @param {boolean} open
   */
  function setPanelOpen(open) {
    panelOpen = open;
    if (open) markAllRead();
  }

  return {
    /** Floating toast peeks, oldest first (newest renders nearest the bell) */
    get toasts() { return items.filter(t => t.toastVisible); },
    /** Full notification center contents, newest first */
    get notifications() { return [...items].reverse(); },
    get unreadCount() { return items.filter(t => !t.read).length; },
    get panelOpen() { return panelOpen; },

    addToast,
    updateToast,
    dismissToast,
    dismissByKey,
    dismissAll,
    resolveItem,
    removeItem,
    markAllRead,
    clearAll,
    setPanelOpen,
  };
}

export const toastStore = createToastStore();
