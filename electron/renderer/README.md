# electron/renderer/

Renderer-process ES modules loaded by `overlay.html`. Each module handles
one UI concern. Entry point is `main.js`.

## Module index

| Module | Description |
|---|---|
| `main.js` | Entry point -- initializes all modules, voice events, image workflow |
| `state.js` | Global UI state (terminal visibility, minimized, location) |
| `terminal.js` | ghostty-web terminal + AI provider start/stop/resize |
| `settings.js` | Settings page UI, keybind recorder, provider selector, audio devices |
| `messages.js` | Chat message rendering with deduplication |
| `markdown.js` | Secure markdown rendering (marked + DOMPurify) |
| `notifications.js` | Toast notification system |
| `navigation.js` | Sidebar + page routing |
| `chat-input.js` | Chat input bar, text message sending, voice toggle |
| `chat-store.js` | Chat persistence and sidebar history |
| `browser-panel.js` | Browser automation panel UI |
| `orb-canvas.js` | Canvas-based orb renderer with state animations |
| `theme-engine.js` | Theme presets, color derivation, CSS variable application |
| `log.js` | Renderer-side structured logging (`createLog('[Tag]')`) |
| `utils.js` | Shared utility functions |

## Styles (`styles/`)

10 CSS modules using design tokens from `tokens.css`:

`base.css`, `orb.css`, `panel.css`, `sidebar.css`, `chat.css`,
`terminal.css`, `settings.css`, `notifications.css`, `browser.css`, `tokens.css`
