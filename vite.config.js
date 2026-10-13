import os from 'node:os'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * This machine's addresses on the local network.
 *
 * Read at startup rather than written down, so the allow-list follows the
 * machine when DHCP hands it a different address instead of locking everyone
 * out until someone edits this file.
 */
const lanHosts = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address)

const knownHosts = ['localhost', '127.0.0.1', '.trycloudflare.com', ...lanHosts]
// Keep the development proxy aligned with the API port configured in
// `server/.env`. A stale 4001 default made every sign-in fail before the
// request reached the running API on 4002.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4002'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /* Shared platform UI. Apps import from here; never from each other. */
      '@ui': fileURLToPath(new URL('./packages/ui/src', import.meta.url)),
      /* Session, tenant and transport — owned by the shell, read by apps. */
      '@platform': fileURLToPath(new URL('./packages/platform', import.meta.url)),
    },
  },
  server: {
    // Quick tunnels get a fresh random hostname each time they start, so the
    // host cannot be listed literally. Vite rejects unknown Host headers by
    // default (CVE-2025-31486), which shows up as a bare 403 from the tunnel.
    allowedHosts: knownHosts,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  /**
   * The tunnel serves the built app, not the dev server.
   *
   * `vite dev` ships every source file as its own request — this app loads in
   * 611 of them. On this machine that is instant; through a tunnel, at well
   * over a second of latency each, the page takes minutes and some requests
   * simply never arrive, which is what "the external link does not work" was.
   * The build is a handful of files, so it travels.
   *
   * Preview needs its own host list and proxy: the `server` block above
   * applies to `vite dev` only.
   */
  preview: {
    // Reachable from other devices on this network, not just this machine —
    // that address is the one that does not change.
    host: true,
    allowedHosts: knownHosts,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
