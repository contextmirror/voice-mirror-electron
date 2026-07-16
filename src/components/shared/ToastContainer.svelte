<script>
  /**
   * ToastContainer.svelte -- Floating overlay that stacks toast notifications.
   *
   * Bottom-right, floating just above the status bar's notification bell —
   * toasts pop out of the corner the bell lives in. Newest toast appears
   * closest to the bell; older ones are pushed up and reflow smoothly.
   * Always mounted in App.svelte.
   */
  import { flip } from 'svelte/animate';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toast from './Toast.svelte';

  function handleDismiss(id) {
    toastStore.dismissToast(id);
  }

  function handleResolve(id) {
    toastStore.resolveItem(id);
  }
</script>

<!-- Suppressed while the notification panel is open: the panel IS the
     notification surface then, and new items land directly inside it. -->
{#if toastStore.toasts.length > 0 && !toastStore.panelOpen}
  <div class="toast-container" aria-live="polite" aria-label="Notifications">
    {#each toastStore.toasts as toast (toast.id)}
      <div class="toast-slot" animate:flip={{ duration: 240 }}>
        <Toast {toast} onDismiss={handleDismiss} onResolve={handleResolve} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    /* Clear the 22px status bar so the stack floats above the notification
       bell in the corner instead of sitting on the bottom panel's content. */
    bottom: 40px;
    right: 12px;
    z-index: 10002;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
    max-height: calc(100vh - 64px);
    overflow: hidden;
  }

  .toast-slot {
    display: flex;
    justify-content: flex-end;
  }
</style>
