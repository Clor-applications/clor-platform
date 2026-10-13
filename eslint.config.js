import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output, caches and copies of the tree. Linting these reported
  // hundreds of errors in code nobody edits — a stale worktree under .claude,
  // an OneDrive-era backup and compiled server output — which buried the real
  // findings in src/.
  globalIgnores([
    'dist',
    'server/dist',
    // Prisma's generated clients. Gitignored, so they were never linted on a
    // fresh clone — but CI generates all three before linting, and `eslint .`
    // then walked thousands of lines of machine-written code and failed the
    // build on unused variables in a file nobody wrote.
    'server/src/generated/**',
    'out',
    '.video',
    '.claude/**',
    '_backup_before_onedrive_restore/**',
    'tmp/**',
  ]),
  {
    // Node context: build scripts and anything under server/ run on Node, so
    // `process`, `console` and friends are defined. Without this every one of
    // them was a no-undef error.
    //
    // .ts is deliberately absent: no TypeScript parser is installed, and
    // adding one here would only duplicate what `npm run typecheck` already
    // does against the server's strict tsconfig.
    files: ['scripts/**/*.{js,mjs,cjs}', 'server/**/*.{js,mjs,cjs}', 'tools/**/*.{js,mjs,cjs}', '*.config.js'],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Capitalised identifiers are components. Without eslint-plugin-react,
      // ESLint cannot see that JSX uses them, so a component destructured from
      // props or a config object reads as unused. The vars pattern already
      // covered imports; args covers `({ icon: Icon }) => <Icon />`.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // Advisory, not defects: "preserve-manual-memoization" means the React
      // compiler skips optimizing that component (it still renders correctly),
      // and the fast-refresh rule only degrades HMR granularity in dev. Both
      // were failing `npm run verify` and burying real errors.
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
