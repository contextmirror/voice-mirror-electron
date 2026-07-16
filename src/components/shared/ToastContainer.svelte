<script>
  /**
   * ToastContainer.svelte -- Floating overlay that stacks toast notifications.
   *
   * Bottom-center, floating just above the status bar. Newest toast appears
   * closest to the status bar; older ones are pushed up and reflow smoothly.
   * Always mounted in App.svelte.
   */
  import { flip } from 'svelte/animate';
  import { toastStore } from '../../lib/stores/toast.svelte.js';
  import Toast from './Toast.svelte';

  function handleDismiss(id) {
    toastStore.dismissToast(id);
  }
</script>

{#if toastStore.toasts.length > 0}
  <div class="toast-container" aria-live="polite" aria-label="Notifications">
    {#each toastStore.toasts as toast (toast.id)}
      <div class="toast-slot" animate:flip={{ duration: 240 }}>
        <Toast {toast} onDismiss={handleDismiss} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    /* Clear the 22px status bar so the capsule floats above app chrome
       instead of sitting on the bottom panel's content. */
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10002;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    max-height: calc(100vh - 64px);
    overflow: hidden;
  }

  .toast-slot {
    display: flex;
    justify-content: center;
  }
</style>
