<script>
  /**
   * Toast.svelte -- Single toast notification: a frosted "status capsule".
   *
   * Compact single-row capsule: tinted severity icon chip, message, inline
   * action pills, dismiss. Severity is carried by the icon chip (theme
   * `--*-subtle` tints), not a border, so it recolors with every theme.
   * Enters by rising from the status bar with a soft pop; sinks on dismiss.
   *
   * Props:
   *   toast {{ id, message, severity, action?, actions?, progress? }} - Toast data
   *   onDismiss {function} - Hide the toast (it stays in the notification center)
   *   onResolve {function} - An action was clicked: the item is dealt with and
   *                          leaves the notification center too
   */
  import { backOut, cubicOut, cubicIn } from 'svelte/easing';

  let { toast, onDismiss = () => {}, onResolve = onDismiss } = $props();

  const severityClass = $derived(toast.severity || 'info');
  // Single `action` and multi `actions` render the same way: inline pills,
  // first one filled (primary), the rest ghost.
  const actionList = $derived(
    toast.action ? [toast.action] : (Array.isArray(toast.actions) ? toast.actions : [])
  );

  function prefersReducedMotion() {
    return typeof matchMedia !== 'undefined'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Pop out of the notification bell in the status-bar corner: the capsule
   * grows from the bell's direction (down-right) with a gentle overshoot,
   * so new toasts visibly come FROM the notification center.
   */
  function capsuleIn(node, { duration = 360 } = {}) {
    if (prefersReducedMotion()) {
      return { duration: 150, easing: cubicOut, css: (t) => `opacity: ${t}` };
    }
    return {
      duration,
      easing: backOut,
      css: (t) => `
        transform-origin: bottom right;
        transform: translate(${(1 - t) * 28}px, ${(1 - t) * 12}px) scale(${0.88 + t * 0.12});
        opacity: ${Math.min(1, t * 1.6)};
      `,
    };
  }

  /**
   * Tuck back into the bell, quicker than the entrance — dismissal reads
   * as the toast being filed into the notification center's history.
   */
  function capsuleOut(node, { duration = 180 } = {}) {
    if (prefersReducedMotion()) {
      return { duration: 120, easing: cubicIn, css: (t) => `opacity: ${t}` };
    }
    return {
      duration,
      easing: cubicIn,
      css: (t) => `
        transform-origin: bottom right;
        transform: translate(${(1 - t) * 18}px, ${(1 - t) * 8}px) scale(${0.92 + t * 0.08});
        opacity: ${t};
      `,
    };
  }
</script>

<div
  class="toast {severityClass}"
  role="alert"
  aria-live="polite"
  in:capsuleIn
  out:capsuleOut
>
  <div class="toast-row">
    <!-- Severity icon in a tinted chip -->
    <span class="toast-icon" aria-hidden="true">
      {#if toast.severity === 'success'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else if toast.severity === 'warning'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      {:else if toast.severity === 'error'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      {/if}
    </span>

    <!-- Message -->
    <span class="toast-message">{toast.message}</span>

    <!-- Inline action pills (single `action` or `actions` array) -->
    {#if actionList.length > 0}
      <span class="toast-actions">
        {#each actionList as act, i}
          <button
            class="toast-action"
            class:primary={i === 0}
            onclick={() => {
              act.callback();
              onResolve(toast.id);
            }}
          >
            {act.label}
          </button>
        {/each}
      </span>
    {/if}

    <!-- Dismiss button -->
    <button
      class="toast-close"
      onclick={() => onDismiss(toast.id)}
      aria-label="Dismiss notification"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <!-- Progress bar (for downloads, etc.) -->
  {#if toast.progress != null}
    <div class="toast-progress-track">
      <div
        class="toast-progress-bar"
        style="width: {Math.min(100, Math.max(0, toast.progress))}%"
        role="progressbar"
        aria-valuenow={toast.progress}
        aria-valuemin="0"
        aria-valuemax="100"
      ></div>
    </div>
  {/if}
</div>

<style>
  .toast {
    display: flex;
    flex-direction: column;
    /* Frosted capsule: translucent elevated surface + blur reads as app
       chrome (not a solid card) in every theme, light or dark. */
    background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
    backdrop-filter: blur(14px) saturate(1.3);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 12.5px;
    pointer-events: auto;
    max-width: min(680px, calc(100vw - 32px));
    overflow: hidden;
  }

  .toast-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 8px 8px;
    flex-wrap: wrap;
  }

  /* Severity icon chip — tinted square, recolors with the theme */
  .toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .toast-icon svg {
    width: 14px;
    height: 14px;
  }

  .toast.info .toast-icon    { color: var(--accent); background: var(--accent-subtle); }
  .toast.success .toast-icon { color: var(--ok);     background: var(--ok-subtle); }
  .toast.warning .toast-icon { color: var(--warn);   background: var(--warn-subtle); }
  .toast.error .toast-icon   { color: var(--danger); background: var(--danger-subtle); }

  /* Message */
  .toast-message {
    flex: 1;
    min-width: 0;
    line-height: 1.45;
    padding-right: 2px;
  }

  /* Inline action pills */
  .toast-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .toast-action {
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-family);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-out),
                border-color var(--duration-fast) var(--ease-out);
  }

  .toast-action:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .toast-action.primary {
    background: var(--accent);
    color: var(--accent-contrast, white);
    border-color: transparent;
  }

  .toast-action.primary:hover {
    background: var(--accent-hover);
  }

  /* Progress bar */
  .toast-progress-track {
    height: 3px;
    margin: 0 10px 8px;
    background: var(--border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .toast-progress-bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease-out;
    border-radius: var(--radius-full);
  }

  /* Close button */
  .toast-close {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: color var(--duration-fast) var(--ease-out),
                background var(--duration-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .toast-close:hover {
    color: var(--text-strong);
    background: var(--bg-hover);
  }

  @media (prefers-reduced-motion: reduce) {
    .toast-action,
    .toast-close,
    .toast-progress-bar {
      transition: none;
    }
  }
</style>
