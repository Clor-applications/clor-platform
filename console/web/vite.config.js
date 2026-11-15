import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * The Engineering Console's own build (docs/console/CONSOLE-SPEC.md). A
 * separate entry and a separate output folder: nothing under apps/ or
 * packages/ops is reachable from here, and the customer build never sees
 * console/. It shares packages/ui for the tokens, the type and the logo.
 *
 *   npm run console:dev     the page on 5191, the API (canned answers) on 4010
 *   npm run console:build   dist-console/, published to Pages project clor-console
 */
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL('../../dist-console', import.meta.url)), emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5191,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.CONSOLE_API_PORT || 4010}`, changeOrigin: false } },
  },
})
