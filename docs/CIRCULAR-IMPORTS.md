# Dynamic-import boundaries Rollup cannot honour

Inventory only. Nothing here is refactored yet — extraction needs its own task
and its own plan. Captured 2026-09-17 from `npm run build`.

## The exact warnings

```
(!) src/features/sales/InvoicePreview.jsx is dynamically imported by src/App.jsx
    but also statically imported by src/features/sales/index.jsx,
    dynamic import will not move module into another chunk.

(!) src/App.jsx is dynamically imported by src/components/pickers/LedgerField.jsx
    but also statically imported by src/main.jsx,
    dynamic import will not move module into another chunk.
```

## Why Rollup cannot split either one

A module gets its own chunk only when *every* path to it is dynamic. One static
importer anywhere pins it into that importer's chunk, and every `lazy()` aimed
at it then resolves to code that is already loaded. The `lazy()` is not wrong —
it is inert.

## A. `LedgerField` to `App.jsx`, for `ChartAccountForm`

| | |
| --- | --- |
| Importer (dynamic) | `src/components/pickers/LedgerField.jsx:21` — `lazy(() => import('../../App').then((m) => ({ default: m.ChartAccountForm })))` |
| Importer (static) | `src/main.jsx:4` — `import App from './App.jsx'` |
| Imported | `src/App.jsx`, 14,752 lines |
| Direction | `LedgerField` to `App`, and `App` renders `LedgerField`. A genuine cycle. |
| Needs extraction | `ChartAccountForm`, declared and exported at `src/App.jsx:2711` |

`App.jsx` is the application entry: `main.jsx` imports it statically, so it is
in the entry chunk by definition and always will be. **It is therefore not
duplicated into other chunks, and extracting `ChartAccountForm` will not
subtract its weight from the entry.** Any claim of a multi-hundred-kilobyte
saving here is unmeasured; treat the size question as open until someone builds
both ways and compares.

What extraction actually buys:

- **Dependency direction.** A leaf picker currently reaches up into the root
  module. Every ledger field in the product drags the whole application into
  its module graph on paper, which is why the cycle exists at all.
- **Module ownership.** A master form belongs in `src/features/accounting/`,
  beside the screen that owns the master — not in the routing shell.
- **An honest lazy boundary.** Once `ChartAccountForm` is its own module with
  two consumers, the `lazy()` can really defer it and the create-a-ledger route
  costs nothing until it is taken — which is what the code comment already
  claims it does.
- **A precondition for route-level splitting.** While the root is a cycle
  participant, nothing under it can be reasoned about as a separate route.

## B. `App.jsx` to `InvoicePreview`, which `sales/index.jsx` also imports

| | |
| --- | --- |
| Importer (dynamic) | `src/App.jsx:126` — `lazy(() => import('./features/sales/InvoicePreview'))` |
| Importer (static) | `src/features/sales/index.jsx:51` — `import InvoicePreview from './InvoicePreview'` |
| Imported | `src/features/sales/InvoicePreview.jsx` |
| Direction | Not a cycle — two importers disagreeing about how to load one module. |
| Needs extraction | Nothing. One of the two importers has to change. |

Cheaper to settle than A: either `sales/index.jsx` loads it lazily too, or
`App.jsx` stops pretending to. `InvoicePreview` pulls the print stack, so the
dynamic side looks worth keeping — but a preview opened from the sales module
is a likely enough action that a static import in both places may be the honest
answer. Decide it deliberately; do not leave two importers contradicting each
other.

## Not in scope here

Splitting `App.jsx` itself. 14,752 lines is real debt, but decomposing a
god-component before route and state ownership are settled produces one file
plus twenty-five tightly coupled ones, not a modular architecture.
