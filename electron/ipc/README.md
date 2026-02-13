# electron/ipc/

IPC handler modules for the Electron main process. Each module handles
a domain of `ipcMain.handle()` channels, registered via `index.js`.

## Module index

| Module | Channels | Description |
|---|---|---|
| `index.js` | -- | Registers all sub-modules with ipcMain |
| `validators.js` | -- | Shared argument validation schemas |
| `ai.js` | `start-claude`, `stop-claude`, `get-claude-status`, ... | AI provider lifecycle and diagnostics |
| `config.js` | `get-config`, `set-config`, `reset-config`, ... | Configuration read/write |
| `screen.js` | `capture-screen`, `get-screens` | Screen capture and monitor enumeration |
| `window.js` | `toggle-expand`, `set-window-position`, ... | Window management and drag |
| `misc.js` | `open-external`, `read-clipboard`, `add-font`, ... | Fonts, clipboard, CLI checks |
