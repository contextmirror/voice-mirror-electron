import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [
    svelte(),
    mode === 'production' && visualizer({ filename: 'stats.html', gzipSize: true }),
  ].filter(Boolean),

  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
  },

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Dependency pre-bundling (esbuild optimize step).
  // - include every CodeMirror/Lezer package the editor pulls in, INCLUDING the
  //   ones that are only reached via lazy dynamic import() (codemirror, autocomplete,
  //   lint, merge, lang-*). The dev launcher wipes node_modules/.vite on every start,
  //   so Vite cold-optimizes each run. If a dynamic-only dep isn't pre-bundled up
  //   front, the first file-open triggers an on-the-fly re-optimization + full page
  //   reload, which invalidates the in-flight `.vite/deps/<dep>.js?v=<hash>` chunk and
  //   surfaces as "Failed to fetch dynamically imported module". Listing them here
  //   forces deterministic pre-bundling during cold start, before any file is opened.
  optimizeDeps: {
    include: [
      'codemirror',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/autocomplete',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/merge',
      '@codemirror/lang-javascript',
      '@codemirror/lang-json',
      '@codemirror/lang-css',
      '@codemirror/lang-html',
      '@codemirror/lang-markdown',
      '@codemirror/lang-python',
      '@codemirror/lang-rust',
      '@codemirror/theme-one-dark',
      '@replit/codemirror-minimap',
      '@replit/codemirror-vscode-keymap',
      '@replit/codemirror-indentation-markers',
      '@lezer/common',
      '@lezer/highlight',
    ],
  },
  assetsInclude: ['**/*.wasm'],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            'codemirror',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/search',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
            '@codemirror/lang-css',
            '@codemirror/lang-html',
            '@codemirror/lang-markdown',
            '@codemirror/lang-python',
            '@codemirror/lang-rust',
            '@codemirror/theme-one-dark',
            '@codemirror/merge',
            '@lezer/common',
            '@lezer/lr',
            '@lezer/highlight',
            '@lezer/javascript',
            '@lezer/json',
            '@lezer/css',
            '@lezer/html',
            '@lezer/markdown',
            '@lezer/python',
            '@lezer/rust',
          ],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl', '@xterm/addon-unicode11'],
          markdown: ['highlight.js', 'dompurify', 'marked', 'marked-highlight'],
        },
      },
    },
  },

  server: {
    // Deliberately weird, fixed port well clear of the default Tauri/Vite 1420 —
    // so apps built/previewed inside VM (which default to 1420) never collide with
    // Voice Mirror's own dev server.
    port: 31420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 31421,
        }
      : undefined,
  },
}));
