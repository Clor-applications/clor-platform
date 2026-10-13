/**
 * The app boundaries, enforced by a tool rather than by remembering.
 *
 * These rules were previously a test that read source files and matched import
 * strings with regular expressions. It worked, and it was the wrong shape: it
 * knew nothing about module resolution, so `@ui/...` and `../../packages/ui`
 * were different things to it, a re-export through a third file was invisible,
 * and every new rule meant more string matching. It also only covered Payroll,
 * because that is the app somebody happened to write it for.
 *
 * What the rules say, in one sentence each:
 *
 *   The shell knows apps only as manifests.
 *   An app never reaches into another app.
 *   Shared UI is shared, so it may not depend on any app.
 *   Payroll reaches Accounting's data through one adapter and nothing else.
 *
 * Run: npm run lint:boundaries
 */

module.exports = {
  forbidden: [
    {
      name: 'shell-imports-app-internals',
      severity: 'error',
      comment:
        'The shell may import an app manifest and nothing else. The moment it ' +
        'imports a screen it knows what a payslip is, and the apps stop being ' +
        'separable — which is the whole of what this structure buys.',
      from: { path: '^packages/shell' },
      to: { path: '^apps/[^/]+/src' },
    },
    {
      name: 'app-imports-another-app',
      severity: 'error',
      comment:
        'Apps meet through the platform, never directly. A component two apps ' +
        'need belongs in packages/ui; data one app needs from another goes ' +
        'through an adapter with an interface, so the other app can change ' +
        'without breaking it.',
      from: { path: '^apps/([^/]+)/' },
      to: {
        path: '^apps/([^/]+)/',
        pathNot: '^apps/$1/',
      },
    },
    {
      name: 'shared-ui-depends-on-an-app',
      severity: 'error',
      comment:
        'packages/ui is shared by every app, so it cannot depend on one. This ' +
        'caught real cases: an item picker importing Accounting features, and ' +
        'a ledger field lazily importing its App.jsx — both of which made the ' +
        '"shared" package Accounting-only in practice.',
      from: { path: '^packages/ui' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-ui-depends-on-the-shell',
      severity: 'error',
      comment:
        'A component that reaches into the shell cannot be rendered outside ' +
        'it — in a test, in a story, in another host. Session and tenant come ' +
        'in through @platform, which is the contract for exactly this.',
      from: { path: '^packages/ui' },
      to: { path: '^packages/shell' },
    },
    {
      name: 'platform-depends-on-anything-above-it',
      severity: 'error',
      comment:
        'The platform layer is what everything else is built on: session, ' +
        'tenant, transport. A dependency upward makes the foundation need its ' +
        'own building.',
      from: { path: '^packages/platform' },
      to: { path: '^(apps/|packages/(ui|shell))' },
    },
    {
      name: 'payroll-reaches-past-its-adapter',
      severity: 'error',
      comment:
        "Payroll's own database is its own. Accounting's is reached through " +
        'services/payroll/accounting/client.ts, which is the only file allowed ' +
        "to import Accounting's Prisma client or its ledger service. A second " +
        'door is a second thing to keep in step.',
      from: {
        path: '^server/src/services/payroll/',
        pathNot: '^server/src/services/payroll/accounting/client\\.ts$',
      },
      to: { path: '^server/src/(utils/prisma|services/ledger)\\.ts$' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means neither module can be understood, tested or replaced ' +
        'without the other.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports is either dead or wired up wrongly.',
      from: {
        orphan: true,
        pathNot: [
          '^(main|vite\\.config|tailwind\\.config|postcss\\.config|eslint\\.config)\\.',
          '\\.d\\.ts$',
          '(^|/)server/src/(index|app)\\.ts$',
          '(^|/)server/src/(scripts|__tests__)/',
          '(^|/)server/src/generated/',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '^dist',
        '^server/dist',
        '^server/src/generated',
        '\\.test\\.(ts|tsx|js|jsx)$',
      ],
    },
    /*
     * The aliases the app is built with. Without these every `@ui/...` import
     * is unresolvable, and a rule about what may import what cannot see half
     * the graph — which is how a boundary check passes while the boundary is
     * being crossed.
     */
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    /* Where `@ui` and `@platform` point — see webpack.resolve.cjs. Without
       them every aliased import is unresolvable, and a rule about what may
       import what cannot see half the graph, which is how a boundary check
       passes while the boundary is being crossed. */
    webpackConfig: { fileName: 'webpack.resolve.cjs' },
    tsPreCompilationDeps: true,
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
