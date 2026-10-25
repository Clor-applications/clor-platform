import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/*
 * clor.in: a static site. `npm run build` renders every route to HTML
 * (scripts/prerender.mjs). The legal pages are the app's own documents
 * (packages/shell/legal), so the site and the app always show the same text;
 * their operator details come from the same VITE_* settings (website/.env).
 */
export default defineConfig({
  plugins: [react()],
  envDir: '.',
  resolve: {
    alias: { '@platform': fileURLToPath(new URL('../packages/platform', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
