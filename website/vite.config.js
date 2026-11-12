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
    /* One React: files shared from ../packages, and the icon set installed at the repo root, would otherwise bring
       the root's copy beside the site's own and every hook would fail (blank page, failed prerender). */
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: ['..'] } },
  /* The prerender bundles the icon set, so it uses the site's React too instead of the root's at run time. */
  ssr: { noExternal: ['@phosphor-icons/react'] },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
