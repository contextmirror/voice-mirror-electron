<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { readFile, getFileGitContent } from '../../lib/api.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';

  let { tab } = $props();

  let editorEl;
  let view;
  let loading = $state(true);
  let error = $state(null);
  let isBinary = $state(false);
  let stats = $state({ additions: 0, deletions: 0 });

  async function loadLanguage(filePath) {
    const ext = filePath?.split('.').pop()?.toLowerCase() || '';
    try {
      switch (ext) {
        case 'js': case 'jsx': case 'mjs': case 'cjs': {
          const { javascript } = await import('@codemirror/lang-javascript');
          return javascript();
        }
        case 'ts': case 'tsx': {
          const { javascript } = await import('@codemirror/lang-javascript');
          return javascript({ typescript: true });
        }
        case 'rs': {
          const { rust } = await import('@codemirror/lang-rust');
          return rust();
        }
        case 'css': case 'scss': {
          const { css } = await import('@codemirror/lang-css');
          return css();
        }
        case 'html': case 'svelte': {
          const { html } = await import('@codemirror/lang-html');
          return html();
        }
        case 'json': {
          const { json } = await import('@codemirror/lang-json');
          return json();
        }
        case 'md': case 'markdown': {
          const { markdown } = await import('@codemirror/lang-markdown');
          return markdown();
        }
        case 'py': case 'python': {
          const { python } = await import('@codemirror/lang-python');
          return python();
        }
        default:
          return [];
      }
    } catch (err) {
      console.warn('[DiffViewer] Language load failed for', ext, err);
      return [];
    }
  }

  /**
   * Count additions and deletions by comparing old and new line counts per-line.
   */
  function countChanges(oldContent, newContent) {
    const oldLines = oldContent ? oldContent.split('\n') : [];
    const newLines = newContent ? newContent.split('\n') : [];
    // Simple heuristic: count lines unique to each side
    const oldSet = new Map();
    for (const line of oldLines) {
      oldSet.set(line, (oldSet.get(line) || 0) + 1);
    }
    const newSet = new Map();
    for (const line of newLines) {
      newSet.set(line, (newSet.get(line) || 0) + 1);
    }
    let additions = 0;
    let deletions = 0;
    for (const [line, count] of newSet) {
      const oldCount = oldSet.get(line) || 0;
      if (count > oldCount) additions += count - oldCount;
    }
    for (const [line, count] of oldSet) {
      const newCount = newSet.get(line) || 0;
      if (count > newCount) deletions += count - newCount;
    }
    return { additions, deletions };
  }

  onMount(async () => {
    try {
      const root = projectStore.activeProject?.path || null;

      // Fetch old (HEAD) and new (working tree) content in parallel
      const [oldResult, newResult] = await Promise.all([
        tab.status === 'added'
          ? Promise.resolve({ success: true, data: { content: '', isNew: true } })
          : getFileGitContent(tab.path, root),
        tab.status === 'deleted'
          ? Promise.resolve({ success: true, data: { content: '' } })
          : readFile(tab.path, root),
      ]);

      const oldData = oldResult?.data || oldResult;
      const newData = newResult?.data || newResult;

      // Handle binary files
      if (oldData?.binary || newData?.binary) {
        isBinary = true;
        loading = false;
        return;
      }

      // Handle errors
      if (oldResult?.error && tab.status !== 'added') {
        error = oldResult.error;
        loading = false;
        return;
      }
      if (newResult?.error && tab.status !== 'deleted') {
        error = newResult.error;
        loading = false;
        return;
      }

      const oldContent = oldData?.content ?? '';
      const newContent = newData?.content ?? '';

      // Count stats
      stats = countChanges(oldContent, newContent);

      // Dynamically import CodeMirror + merge
      const [
        { EditorView, basicSetup },
        { EditorState },
        { unifiedMergeView },
        { oneDark },
      ] = await Promise.all([
        import('codemirror'),
        import('@codemirror/state'),
        import('@codemirror/merge'),
        import('@codemirror/theme-one-dark'),
      ]);

      // Load language support based on file extension
      const langSupport = await loadLanguage(tab.path);

      const extensions = [
        basicSetup,
        oneDark,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        unifiedMergeView({
          original: oldContent,
          mergeControls: false,
          highlightChanges: true,
          gutter: true,
        }),
      ];

      // Add language support if available
      if (langSupport && !Array.isArray(langSupport)) {
        extensions.splice(1, 0, langSupport);
      } else if (Array.isArray(langSupport) && langSupport.length > 0) {
        extensions.splice(1, 0, ...langSupport);
      }

      const state = EditorState.create({
        doc: newContent,
        extensions,
      });

      loading = false;
      await tick();

      if (editorEl) {
        view = new EditorView({ state, parent: editorEl });
      }
    } catch (err) {
      console.error('[DiffViewer] Mount failed:', err);
      error = err.message || 'Failed to load diff';
      loading = false;
    }
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

{#if isBinary}
  <div class="diff-placeholder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="placeholder-title">Binary file</span>
    <span class="placeholder-detail">Cannot show diff for binary files.</span>
  </div>
{:else if error}
  <div class="diff-placeholder">
    <span class="error-text">{error}</span>
  </div>
{:else}
  {#if !loading}
    <div class="diff-toolbar">
      <span class="diff-path">{tab.path}</span>
      <span class="diff-stats">
        {#if stats.additions > 0}
          <span class="stat-add">+{stats.additions}</span>
        {/if}
        {#if stats.deletions > 0}
          <span class="stat-del">-{stats.deletions}</span>
        {/if}
      </span>
    </div>
  {/if}
  <div class="diff-viewer" bind:this={editorEl}>
    {#if loading}
      <div class="diff-loading">
        <span class="loading-text">Loading diff...</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .diff-viewer {
    flex: 1;
    overflow: hidden;
    height: 100%;
    position: relative;
  }

  /* Override CodeMirror to fill available space */
  .diff-viewer :global(.cm-editor) {
    height: 100%;
  }

  .diff-viewer :global(.cm-scroller) {
    overflow: auto;
  }

  /* Merge view: green for additions, red for deletions */
  .diff-viewer :global(.cm-changedLine) {
    background: color-mix(in srgb, var(--ok) 12%, transparent) !important;
  }

  .diff-viewer :global(.cm-deletedChunk) {
    background: color-mix(in srgb, var(--danger) 12%, transparent) !important;
  }

  /* Inline word-level highlights */
  .diff-viewer :global(.cm-changedText) {
    background: color-mix(in srgb, var(--ok) 25%, transparent) !important;
  }

  .diff-viewer :global(.cm-deletedChunk .cm-deletedText),
  .diff-viewer :global(.cm-deletedText) {
    background: color-mix(in srgb, var(--danger) 25%, transparent) !important;
  }

  /* Gutter markers */
  .diff-viewer :global(.cm-changeGutter) {
    width: 3px;
    padding: 0;
  }

  .diff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .diff-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--muted);
  }

  .diff-stats {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    font-weight: 600;
  }

  .stat-add {
    color: var(--ok);
  }

  .stat-del {
    color: var(--danger);
  }

  .diff-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .diff-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--muted);
    font-size: 13px;
    font-family: var(--font-family);
  }

  .placeholder-title {
    font-weight: 600;
    color: var(--text);
    font-size: 14px;
  }

  .placeholder-detail {
    color: var(--muted);
    font-size: 12px;
  }

  .error-text {
    color: var(--danger, #ef4444);
  }
</style>
