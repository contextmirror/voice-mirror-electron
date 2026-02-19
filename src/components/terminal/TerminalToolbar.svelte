<script>
  /**
   * TerminalToolbar -- Toolbar above the terminal with voice control, clear, copy, paste.
   *
   * Props:
   *   onClear {function} - Clear the terminal screen
   *   onCopy {function} - Copy selected text to clipboard
   *   onPaste {function} - Paste from clipboard into terminal
   */
  import { sendVoiceLoop } from '../../lib/api.js';
  import { voiceStore } from '../../lib/stores/voice.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';
  import { configStore } from '../../lib/stores/config.svelte.js';
  import { toastStore } from '../../lib/stores/toast.svelte.js';

  let {
    onClear = () => {},
    onCopy = () => {},
    onPaste = () => {},
  } = $props();

  // ---- Voice button state ----

  let voiceLoading = $state(false);

  /** Voice loop is actively listening or recording */
  let voiceActive = $derived(
    voiceStore.state === 'listening' || voiceStore.state === 'recording'
  );

  /** Show the voice button only for running CLI providers */
  let showVoiceButton = $derived(
    aiStatusStore.running && aiStatusStore.isCliProvider
  );

  async function handleStartVoice() {
    if (voiceLoading) return;
    voiceLoading = true;
    const name = configStore.value?.user?.name || 'user';
    try {
      await sendVoiceLoop(name);
      toastStore.addToast({
        message: 'Voice loop started — listening for input',
        severity: 'success',
        duration: 3000,
      });
    } catch (err) {
      console.error('[TerminalToolbar] Failed to start voice loop:', err);
      toastStore.addToast({
        message: 'Failed to start voice loop',
        severity: 'error',
      });
    } finally {
      voiceLoading = false;
    }
  }
</script>

<div class="terminal-toolbar">
  <div class="toolbar-left">
    <span class="toolbar-title">Terminal</span>
    {#if showVoiceButton}
      <button
        class="voice-btn"
        class:active={voiceActive}
        onclick={handleStartVoice}
        disabled={voiceLoading}
        title={voiceActive ? 'Voice loop is active' : 'Start voice loop for this session'}
      >
        {#if voiceActive}
          <span class="voice-dot"></span>
          <span class="voice-label">Voice Active</span>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span class="voice-label">{voiceLoading ? 'Starting...' : 'Start Voice'}</span>
        {/if}
      </button>
    {/if}
  </div>
  <div class="toolbar-actions">
    <button class="toolbar-btn" onclick={onClear} title="Clear terminal">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
        <line x1="18" y1="9" x2="12" y2="15"/>
        <line x1="12" y1="9" x2="18" y2="15"/>
      </svg>
      <span class="btn-label">Clear</span>
    </button>
    <button class="toolbar-btn" onclick={onCopy} title="Copy selection (Ctrl+C)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span class="btn-label">Copy</span>
    </button>
    <button class="toolbar-btn" onclick={onPaste} title="Paste (Ctrl+V)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      </svg>
      <span class="btn-label">Paste</span>
    </button>
  </div>
</div>

<style>
  .terminal-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 36px;
    user-select: none;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ---- Voice button ---- */

  .voice-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-in-out);
  }

  .voice-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .voice-btn:active:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .voice-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voice-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Active state: green, subdued */
  .voice-btn.active {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
    color: var(--ok);
    cursor: default;
  }

  .voice-btn.active:hover {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  .voice-btn svg {
    flex-shrink: 0;
  }

  .voice-label {
    pointer-events: none;
    white-space: nowrap;
  }

  .voice-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
    animation: voice-pulse 2s ease-in-out infinite;
  }

  @keyframes voice-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ---- Existing toolbar buttons ---- */

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-in-out),
                background var(--duration-fast) var(--ease-in-out);
  }

  .toolbar-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .toolbar-btn:active {
    color: var(--text-strong);
    background: var(--bg-accent);
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .btn-label {
    pointer-events: none;
  }

  .toolbar-btn svg {
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-dot {
      animation: none;
    }
  }
</style>
