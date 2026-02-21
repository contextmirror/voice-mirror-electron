<script>
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { chatStore } from '../../lib/stores/chat.svelte.js';
  import { chatLoad, chatSave } from '../../lib/api.js';
  import { uid } from '../../lib/utils.js';


  let activeProject = $derived(projectStore.activeProject);
  let sessions = $derived(projectStore.sessions);

  /**
   * Format relative time from a timestamp.
   * @param {number} ts - Unix ms timestamp
   * @returns {string}
   */
  function formatRelativeTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const then = typeof ts === 'number' ? ts : new Date(ts).getTime();
    const diffMs = now - then;
    if (isNaN(diffMs) || diffMs < 0) return '';

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days === 1) return '1d';
    if (days < 7) return `${days}d`;

    return new Date(then).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  }

  async function handleLoadSession(id) {
    try {
      const result = await chatLoad(id);
      const chat = result?.success !== false ? (result?.data || result) : null;
      if (!chat) return;

      chatStore.setActiveChatId(chat.id);
      chatStore.clearMessages();

      if (chat.messages && chat.messages.length > 0) {
        for (const msg of chat.messages) {
          chatStore.addMessage(msg.role, msg.content || msg.text, msg.metadata || {});
        }
      }

      // Stay in Lens mode — the LensWorkspace chat panel picks up the active chat
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to load session:', err);
    }
  }

  async function handleNewSession() {
    if (!activeProject) return;

    const id = uid();
    const now = Date.now();
    const chat = {
      id,
      name: 'New Session',
      messages: [],
      createdAt: now,
      updatedAt: now,
      projectPath: activeProject.path,
    };

    try {
      await chatSave(chat);
      chatStore.setActiveChatId(id);
      chatStore.clearMessages();
      // Stay in Lens mode — reload sessions to show the new one
      projectStore.loadSessions();
    } catch (err) {
      console.error('[SessionPanel] Failed to create session:', err);
    }
  }
</script>

<div class="session-panel">
  <div class="session-header">
    {activeProject?.name || 'No Project'}
  </div>

  <div class="session-list">
    {#each sessions as session (session.id)}
      <button
        class="session-item"
        class:active={session.id === chatStore.activeChatId}
        onclick={() => handleLoadSession(session.id)}
      >
        <span class="session-name">{session.name || 'Untitled'}</span>
        <span class="session-time">{formatRelativeTime(session.updatedAt)}</span>
      </button>
    {:else}
      <div class="session-empty">No sessions yet</div>
    {/each}
  </div>

  <button
    class="new-session-btn"
    onclick={handleNewSession}
    disabled={!activeProject}
  >
    + New Session
  </button>
</div>

<style>
  .session-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 8px;
    min-height: 0;
  }

  .session-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
    padding: 4px 8px 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    background: transparent;
    border: none;
    font-family: var(--font-family);
    text-align: left;
    width: 100%;
    transition: all var(--duration-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .session-item:hover {
    background: var(--bg-hover);
  }

  .session-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .session-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-time {
    color: var(--muted);
    font-size: 10px;
    flex-shrink: 0;
  }

  .session-empty {
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    padding: 24px 8px;
  }

  .new-session-btn {
    flex-shrink: 0;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font-family);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
    margin-top: 4px;
  }

  .new-session-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-hover);
  }

  .new-session-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    .session-item,
    .new-session-btn {
      transition: none;
    }
  }
</style>
