# Code Quality Improvement Plan

**Branch**: `refactor/code-quality`
**Date**: 2026-02-13
**Baseline**: v0.8.1 (post Spring Cleaning — 3,400 lines dead code removed)

---

## Phase 1: Audit Leftovers

### 1A. Deduplicate CLI_PROVIDERS constant
- Create `electron/constants.js` with shared constants (CLI_PROVIDERS, API endpoints, timeouts)
- Update all consumers: config.js, claude-spawner.js, provider-detector.js, ai-manager.js

### 1B. Extract shared formatResults()
- Duplicated in `browser-search.js` and `serper-search.js`
- Extract into `electron/browser/search-utils.js`

### 1C. Trim over-exported internals
- `webview-snapshot.js` and `webview-actions.js` export internal helpers that nothing imports
- Make helpers private, export only public API

---

## Phase 2: Logging Standardisation

**Problem**: 336 `console.log/error` calls, only 6 structured logger calls.
Inconsistent prefixes: `[Voice Mirror]`, `[Browser Search]`, `[webview-cdp]`, etc.

### Actions
- Extend `logger.js` with level methods: `info()`, `warn()`, `error()`, `debug()`
- Accept tag parameter: `logger.info('[AI Manager]', 'Provider switched')`
- Migrate all console calls module-by-module (~40 files)
- Gate debug logs behind `VOICE_MIRROR_DEBUG=1` or config flag

---

## Phase 3: Error Handling & Response Consistency

**Problem**: Mixed IPC response formats — `{ success, error }`, `{ ok, data }`, plain values, `null`.

### Actions
- Standardise IPC responses to `{ success: boolean, data?: any, error?: string }`
- Standardise browser tool responses to `{ ok: boolean, action: string, result?: any, error?: string }`
- Update all renderer-side consumers

---

## Phase 4: Extract Shared Patterns

### 4A. Windows screen capture helper
- Duplicated in ipc-handlers.js and screen-capture-watcher.js
- Extract to `electron/lib/windows-screen-capture.js`

### 4B. JSON file-watcher factory
- Identical watch-debounce-parse pattern in inbox-watcher, browser-watcher, screen-capture-watcher
- Extract `electron/lib/json-file-watcher.js` factory (~150 lines of duplication per watcher)

### 4C. Platform paths consolidation
- Data directory resolution duplicated in config.js, claude-spawner.js, platform-paths.js
- Consolidate to single source (platform-paths.js)

---

## Phase 5: Service Lifecycle Standardisation

**Problem**: Services use inconsistent lifecycle APIs.

| Service | Start | Stop | Status |
|---------|-------|------|--------|
| ai-manager | start() | stop() | isRunning() |
| python-backend | start() | stop() | isRunning() |
| hotkey-manager | init() | destroy() | (none) |
| browser-watcher | start() | stop() | (none) |

### Actions
- Standardise all services: `start()`, `stop()`, `isRunning()`
- Add `isRunning()` to watchers and hotkey-manager
- Standardise event emission via `.on(event, cb)`

---

## Phase 6: God-File Decomposition

### 6A. Split ipc-handlers.js (889 lines)
```
electron/ipc/
  window.js      (expand, minimize, position, drag)
  config.js      (get/set/reset config)
  screen.js      (capture, get-screens)
  browser.js     (browser control, navigate)
  ai.js          (provider control, diagnostics)
  misc.js        (fonts, external URLs, overlay)
  index.js       (register all sub-modules)
```

### 6B. Extract main.js utilities (~935 → ~600 lines)
- `startOllamaServer()` → `electron/lib/ollama-launcher.js`
- `syncVoiceSettingsToFile()` → into python-backend service
- `ensureLocalLLMRunning()` → into ai-manager service

---

## Phase 7: Test Coverage

**Problem**: 477 tests pass but many are source-inspection style. Zero integration tests.
Large modules untested: ipc-handlers (889 lines), settings.js (1956 lines).

### Actions
- Add behavioral tests for: ai-manager switching, IPC config, JSON file-watcher, constants
- Add integration test scaffold: startup sequence, config corruption recovery
- Convert source-inspection tests to behavioral where feasible

---

## Phase 8: Security Hardening

### 8A. Path validation
- Add `electron/lib/safe-path.js` with `ensureWithin(base, userPath)`
- Use in image save and temp file paths

### 8B. API key logging scrub
- Ensure API keys are never logged, even in debug mode
- Audit claude-spawner.js and openai-provider.js

---

## Execution Order

1. **Batch 1**: Phase 1 + 4 + 8 (foundations, non-overlapping)
2. **Batch 2**: Phase 5 + 6 (architecture, depends on Batch 1)
3. **Batch 3**: Phase 2 + 3 (consistency, applied to new file structure)
4. **Batch 4**: Phase 7 (tests, validates everything)

Tests run after each batch. All work on `refactor/code-quality` branch.
