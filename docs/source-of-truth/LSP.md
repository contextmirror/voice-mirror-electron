# LSP — Voice Mirror's Language Server Protocol Integration

> Source of truth for the LSP subsystem: architecture, feature status, and wiring pointers.
>
> Consolidated 2026-07-02 from three earlier docs (now in `docs/archive/`):
> `2026-03-05-lsp-gap.md` (VS Code gap analysis), `2026-03-05-lsp-wiring-audit.md`
> (backend→frontend wiring audit), and `2026-02-28-lsp-design.md` (original design
> + Zed comparison). File paths below were re-verified 2026-07-02 against the
> current tree — the Lens component split moved editor components into
> `src/components/lens/editor/` and the editor libs into `src/lib/editor/`.

---

## Status: 37/37 feature matrix

Voice Mirror's LSP has full feature parity with VS Code across all categories — core editing, navigation, inline assistance, formatting, visual enhancements, and infrastructure. All 5 backend implementation waves plus the frontend CodeMirror wiring wave are complete. Configuration alignment with VS Code (diagnostic severity remapping, enriched `publishDiagnostics` capabilities, VS Code-compatible TypeScript `initializationOptions`) is also done.

| Category | VS Code | Voice Mirror | Impl | Tested |
|----------|---------|-------------|:----:|:------:|
| Core (5) | 5/5 | 5/5 | 5/5 | 5/5 |
| Navigation Tier 1 (5) | 5/5 | 5/5 | 5/5 | 5/5 |
| Navigation Tier 2 (6) | 6/6 | 6/6 | 6/6 | 3/6 ⏭️3 backend-only |
| Inline Assistance (3) | 3/3 | 3/3 | 3/3 | 3/3 |
| Formatting & Editing (5) | 5/5 | 5/5 | 5/5 | 5/5 |
| Visual (3) | 3/3 | 3/3 | 3/3 | 3/3 |
| Infrastructure (10) | 10/10 | 10/10 | 10/10 | 9/10 |
| **Total** | **37/37** | **37/37** | **37/37** | **34/37** |

---

## Architecture

**What LSP is:** a JSON-RPC 2.0 protocol (over stdin/stdout, `Content-Length`-framed) that separates code intelligence from editors. External language server binaries (`typescript-language-server`, `rust-analyzer`, …) provide the smarts; Voice Mirror spawns them and speaks the protocol. We don't write or bundle the servers.

```
Frontend (Svelte + CodeMirror 6)
  src/components/lens/editor/FileEditor.svelte      ← thin orchestrator
    └── src/lib/editor/editor-lsp.svelte.js         ← LSP factory: handlers + CM extension factories
         (diagnostics, completions, hover, go-to-def, references,
          rename, code actions, inlay hints, code lens, semantic
          tokens, colors, folding, linked editing, formatting …)
  src/lib/stores/lsp-diagnostics.svelte.js          ← global diagnostic store (FileTree badges)
  Tauri events: lsp-diagnostics, lsp-server-status
  Tauri invoke: 45 commands
────────────────────────────────────────────────────
Rust backend — src-tauri/src/lsp/ (11 modules + manifest)
  mod.rs         LspManager: spawn, route, manage servers
  client.rs      JSON-RPC transport, reader loop, diagnostics handling
  requests.rs    LSP request methods (completion, hover, resolve, …)
  documents.rs   didOpen/didChange/didSave/didClose (incremental sync)
  formatting.rs  document/range/on-type formatting
  lifecycle.rs   crash recovery, health monitoring, idle shutdown
  scanning.rs    background project-wide didOpen scanning
  detection.rs   server discovery from file extensions / PATH
  manifest.rs    lsp-servers.json loading (init options, install specs)
  installer.rs   auto-download (npm + GitHub Releases)
  types.rs       URI helpers, event structs
  lsp-servers.json  server manifest
  src-tauri/src/commands/lsp.rs                     ← 45 #[tauri::command] handlers
────────────────────────────────────────────────────
Language servers (external processes)
  7 in the manifest: svelte, typescript, css, html, json, eslint, rust-analyzer
```

**Data flow (diagnostics):** edit → frontend `lspChangeFile()` (debounced 300 ms, incremental) → Rust forwards `textDocument/didChange` → server sends `publishDiagnostics` → reader loop emits `lsp-diagnostics` Tauri event → frontend converts LSP positions to CodeMirror offsets → squiggly underlines + FileTree badges.

**Design decisions (still in force):**

1. **Auto-detect, don't configure** — servers discovered from PATH based on open file types; manifest-driven config.
2. **Rust client, not JS** — the LSP client runs entirely in Rust, like all external-process management in the app.
3. **One server per language per project** — composite `{lang_id}::{project_root}` keys; multi-server routing (primary + supplementary, e.g. ESLint) per file.
4. **Lazy spawn, idle shutdown** — spawned on first file open; 60 s idle shutdown; crash recovery with exponential backoff (max 5) and open-document replay.
5. **Graceful degradation** — no server installed → editor still works with keyword completions.
6. **No bundled servers** — auto-download on demand (npm / GitHub Releases) or user-installed.

---

## Feature Matrix (37 features)

### Core (5)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Diagnostics | `publishDiagnostics` | Full (severity remapping, related info, tags) |
| Completions | `textDocument/completion` | Full (snippets; resolve — see note below) |
| Hover tooltips | `textDocument/hover` | Full (markdown, smart positioning) |
| Go-to-definition | `textDocument/definition` | Full (F12, Ctrl+click, external files read-only) |
| Document sync | `didOpen/didChange/didSave/didClose` | Full (incremental, 300 ms debounce) |

### Navigation Tier 1 (5)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Find all references | `textDocument/references` | Full (Shift+F12 + panel) |
| Rename symbol | `prepareRename` + `rename` | Full (F2, multi-file workspace edit) |
| Code actions / quick fixes | `textDocument/codeAction` | Full (resolve + filtering, context menu) |
| Document symbols / outline | `textDocument/documentSymbol` | Full (OutlinePanel + Ctrl+Shift+O) |
| Document highlight | `textDocument/documentHighlight` | Full (CM extension) |

### Navigation Tier 2 (6)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Type definition | `textDocument/typeDefinition` | Full (context menu) |
| Go-to-declaration | `textDocument/declaration` | Full (backend only — no menu for JS/TS, matching VS Code) |
| Go-to-implementation | `textDocument/implementation` | Full (Ctrl+F12 + context menu) |
| Workspace symbols | `workspace/symbol` | Backend + API (no UI panel yet) |
| Call hierarchy | `callHierarchy/incomingCalls` | Backend + API (no UI panel yet) |
| Type hierarchy | `typeHierarchy/subtypes` | Backend + API (no UI panel yet) |

### Inline Assistance (3)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Signature help | `textDocument/signatureHelp` | Full (auto on `(` `,` + Ctrl+Shift+Space) |
| Inlay hints | `textDocument/inlayHint` | Full (CM ViewPlugin) |
| Code lens | `textDocument/codeLens` | Full (CM StateField widget, 1 s debounce) |

### Formatting & Editing (5)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Document formatting | `textDocument/formatting` | Full (Shift+Alt+F + format-on-save) |
| Range formatting | `textDocument/rangeFormatting` | Full (Shift+Alt+F with selection + context menu) |
| On-type formatting | `textDocument/onTypeFormatting` | Full (triggers `;` `}` newline) |
| Linked editing | `textDocument/linkedEditingRange` | Full (CM transactionFilter — HTML tag pairs) |
| Selection range | `textDocument/selectionRange` | Full |

### Visual Enhancements (3)

| Feature | LSP Method | Status |
|---------|-----------|--------|
| Semantic tokens | `textDocument/semanticTokens` | Full (CM mark decorations, 10 token types) |
| Document colors | `textDocument/documentColor` | Full (CM swatch widget + color picker) |
| Folding ranges | `textDocument/foldingRange` | Full (CM foldService) |

### Infrastructure (10)

| Feature | Status |
|---------|--------|
| Server registry | Full (`lsp-servers.json`, 7 servers) |
| Auto-download servers | Full (npm + github-release) |
| Server config (initOptions + workspace/config) | Full (manifest-driven, VS Code-compatible defaults) |
| Multi-server per file | Full (primary + supplementary routing) |
| Crash recovery | Full (exponential backoff, max 5, doc replay) |
| Health monitoring | Full (30 s stale threshold, Unresponsive state) |
| Idle shutdown | Full (60 s timer, auto-restart on reopen) |
| Project-wide scanning | Full (background didOpen, batched 10/100 ms) |
| Pull diagnostics | Full |
| Remote LSP (SSH) | Not implemented (N/A for now) |

---

## Key Wiring Pointers (paths verified 2026-07-02)

| Layer | Where |
|-------|-------|
| LSP manager + client | `src-tauri/src/lsp/` (`mod.rs`, `client.rs`, `requests.rs`, `documents.rs`, `formatting.rs`, `lifecycle.rs`, `scanning.rs`, `detection.rs`, `manifest.rs`, `installer.rs`, `types.rs`) |
| Server manifest | `src-tauri/src/lsp/lsp-servers.json` (7 servers, VS Code-compatible `initializationOptions`) |
| Tauri commands | `src-tauri/src/commands/lsp.rs` (45 commands) |
| JS API wrappers | `src/lib/api.js` (45 `lsp*` wrappers — 1:1 with commands) |
| Editor LSP factory + CM extensions | `src/lib/editor/editor-lsp.svelte.js` |
| CM extension assembly | `src/lib/editor/editor-extensions.js` |
| Severity utils / theme / hover markdown | `src/lib/editor/lsp-severity.js`, `src/lib/editor/editor-theme.js`, `src/lib/editor/hover-markdown.js` |
| Diagnostic store (FileTree badges) | `src/lib/stores/lsp-diagnostics.svelte.js` |
| Editor orchestrator | `src/components/lens/editor/FileEditor.svelte` |
| LSP UI components | `src/components/lens/editor/` (`CodeActionsMenu.svelte`, `RenameInput.svelte`, `EditorContextMenu.svelte`), `src/components/lens/panels/` (`OutlinePanel.svelte`, `ReferencesPanel.svelte`), `src/components/lens/status/LspTab.svelte` (server management) |

### Checklist for adding a new LSP feature

Gaps historically appeared between "backend works" and "something triggers it" (steps 5–8):

1. **Rust**: add method to `LspManager` (`src-tauri/src/lsp/`)
2. **Rust**: add `#[tauri::command]` in `commands/lsp.rs`
3. **Rust**: register command in `lib.rs`
4. **JS API**: add `export async function lsp...()` in `src/lib/api.js`
5. **editor-lsp**: import API function, create handler or extension factory
6. **editor-lsp**: export handler/extension in the return object
7. **editor-extensions**: wire extension into CM (push into extensions array)
8. **or FileEditor**: wire handler into the component (keybinding, event, or UI trigger)
9. **Test**: verify the feature actually triggers end-to-end

---

## Known Gaps

**Backend-only (Rust command + API wrapper exist, no frontend UI yet):**

| API Function | Would need |
|---|---|
| `lspRequestWorkspaceSymbols` | Global symbol search in command palette / search panel |
| `lspResolveCompletionItem` | "Detail on select" in the completion popup (backend `completionItem/resolve` works — `src-tauri/src/lsp/requests.rs`; wrapper verified unused in the frontend 2026-07-02) |
| `lspPrepareCallHierarchy` / `lspRequestIncomingCalls` / `lspRequestOutgoingCalls` | Call hierarchy panel |
| `lspPrepareTypeHierarchy` / `lspRequestSupertypes` / `lspRequestSubtypes` | Type hierarchy panel |
| `lspRequestSelectionRange` | Expand-selection keybinding |
| `lspSetServerEnabled` / `lspGetServerDetail` | LSP settings panel (partially surfaced in LspTab) |

**Known issues (reported in the 2026-03 audits, not re-verified since):**

- Quick Fix keybinding (Ctrl+.) reported not triggering code actions from the keyboard — works via right-click context menu → "Quick Fix...".

**Intentional non-goals:** remote LSP over SSH; Go-to-declaration keybinding for JS/TS (declaration === definition there, matching VS Code).

---

## History

The LSP subsystem was built across 2026-02/03 in staged waves (core → lifecycle → project-wide/multi-server → visual polish → deep polish → frontend CodeMirror wiring), tracked in three docs that all reached "complete" status and were consolidated into this one on 2026-07-02:

- [`docs/archive/2026-02-28-lsp-design.md`](../archive/2026-02-28-lsp-design.md) — original design: protocol explainer, phase-by-phase status, data flows, design decisions, and the Zed feature/architecture comparison that drove Tier 1/2 prioritization.
- [`docs/archive/2026-03-05-lsp-gap.md`](../archive/2026-03-05-lsp-gap.md) — VS Code gap analysis: configuration alignment detail (severity remapping codes, initializationOptions, publishDiagnostics capabilities), the full per-feature matrix with LSP methods, behavior differences, and the wave-by-wave closure log.
- [`docs/archive/2026-03-05-lsp-wiring-audit.md`](../archive/2026-03-05-lsp-wiring-audit.md) — backend→frontend wiring audit: which API wrappers are wired to which CM extensions/triggers, and the orphan list.
- [`docs/archive/2026-03-04-lsp-gap-closure.md`](../archive/2026-03-04-lsp-gap-closure.md) — the implementation plan used for the gap-closure waves.

Related: [`IDE-GAPS.md`](IDE-GAPS.md) tracks LSP in the wider IDE feature comparison; [`ARCHITECTURE.md`](ARCHITECTURE.md) shows where LSP sits in the whole system.
