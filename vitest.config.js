import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';

/**
 * The web tests. `npm test` runs the server suite; this is the other half.
 *
 * It exists because the keyboard in this product kept being fixed by
 * reasoning about it. Focus, portals and event order are precisely the things
 * that cannot be read off the source — a picker whose arrows look correct in
 * the file can still be answering to the form behind it — so they get run
 * instead of argued about.
 */
export default defineConfig({
  plugins: [react()],
  /* The same aliases the app is built with. A test that cannot resolve `@ui`
     fails on the import rather than on the behaviour it was written for. */
  resolve: {
    alias: {
      '@ui': fileURLToPath(new URL('./packages/ui/src', import.meta.url)),
      '@platform': fileURLToPath(new URL('./packages/platform', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    /* The tree moved: screens live under apps/, shared UI under packages/,
       and the cross-cutting suite that reads the whole codebase is in test/. */
    include: ['apps/**/*.test.{js,jsx}', 'packages/**/*.test.{js,jsx}', 'test/**/*.test.{js,jsx}'],
    setupFiles: ['test/setup.js'],
    globals: true,
    css: false,
    /*
     * Four workers, measured rather than assumed.
     *
     * The obvious lever here looked like the worker count, and it was the
     * wrong one: at eight threads the suite ran at three per cent CPU and two
     * DOM-heavy files crossed the five-second per-test timeout, because the
     * cost was never computation. It was 122 jsdom environments being built.
     * That is what the `@vitest-environment node` banners on the
     * source-reading tests address — src/test went from 922 seconds to 130 on
     * the same 64 tests — and with those in place four workers is enough to
     * keep the slow DOM files inside their timeout.
     */
    pool: 'threads',
    poolOptions: {
      threads: { minThreads: 1, maxThreads: 4 },
    },
    /*
     * Twenty seconds, not five.
     *
     * Two of the heaviest files — the document-form parity check and the
     * debit-note TDS flow — take seven to eight seconds each on their own,
     * and the default budget is five. Under one worker they happened to fit;
     * with four running they do not, and a test that passes alone and times
     * out beside its neighbours is reporting on the machine rather than on
     * the code. The budget is what was wrong, so the budget moves. A test
     * that genuinely hangs still fails, twenty seconds later.
     */
    testTimeout: 20000,
  },
});
