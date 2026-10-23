# PC-UI-01 measurements (computed styles, in-app browser, 24 Oct 2026)

Baseline: Accounting › Sales › Invoices, light theme (`01-accounting-invoices-light.jpg`)

| Element | Accounting (base) |
|---|---|
| `data-palette` | none; `--brand` 39 39 42 |
| `.ui-t-page` | 24px / 28.8px, weight 700, Inter Variable |
| `.ui-t-sec` | 16px, weight 600 |
| `main` font-size | 13px |
| `.ui-btn-primary` | radius 4px, bg rgb(24,24,27), 36px, 13px |
| `.ui-input` | radius 4px, 36px, 13px |
| rail | white |

After the change: People › Home (`02-people-home-light.jpg`), People › Employees light (`03-people-employees-light.jpg`) and dark (`04-people-employees-dark.jpg`)

| Element | People, light | People, dark |
|---|---|---|
| `data-palette` | rose; `--brand` 164 87 97 | rose; `--brand` 216 159 168 |
| `.ui-t-page` | 24px / 28.8px, weight 700, Inter Variable (= Accounting) | same |
| `main` font-size | 13px (= Accounting) | same |
| `.ui-btn-primary` | radius 4px (= Accounting), bg rgb(164,87,97), white text, 36px, 13px | bg rgb(216,159,168), text rgb(9,9,11) |
| `.ui-input` | radius 4px (= Accounting), 36px, 13px | same |
| selected status segment | bg rgb(164,87,97), white | bg rgb(216,159,168), dark ink |
| `--ring` | 164 87 97 | 216 159 168 |
| `[data-app='people']` selectors in `packages/ui/src/index.css` | 0 (was 59) | |

Not changed by this item, noted for the owner: People's shell uses the icon rail with a screens panel (`packages/shell/splitNav.js`), while Accounting uses the full sidebar. That is navigation structure, not page layout; it stays unless the owner asks for Accounting's sidebar in People.
