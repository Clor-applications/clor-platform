# UI-QA harness

## Seeding

```bash
cd server && npm run seed:ui-qa
```

Idempotent. Refuses to run unless the database looks local — see the guard in
`seedUiQa.ts`. Sign in with `ui-qa@clor.local` / `UiQaPassw0rd!23`.

## Theme — set it explicitly, always

The application keeps its own theme state. It reads `localStorage.uiTheme`
and stamps `data-theme` on the root; it does **not** follow
`prefers-color-scheme` once a choice has been stored.

So a screenshot harness that only emulates the browser's colour scheme gets
whatever the app last stored, which on a fresh profile is dark. Set the key:

```js
localStorage.setItem('uiTheme', 'light');   // or 'dark'
location.reload();
```

Emulating `prefers-color-scheme` alone is not equivalent and will silently
produce the wrong theme. This is a property of the product's theme
architecture, not a bug to fix.

## Session

The client sends `x-org-id` and `x-branch-id` from storage, and every
org-scoped route requires both:

```js
localStorage.setItem('token', <from POST /api/auth/login>);
localStorage.setItem('activeOrgId', <orgId from GET /api/auth/me>);
localStorage.setItem('activeBranchId', <a branch id>);
localStorage.setItem('branchId', <the same id>);
```

Without `activeBranchId` every screen renders "Missing x-branch-id" and the
navigation collapses to Home.

## Measuring geometry

`tools/qaMeasure.js` returns the numbers this QA pass is judged on. It is not
served — read the file and evaluate its text in the page, because anything
placed under `public/` is copied into `dist/` and shipped:

```js
// with the file's contents in `src`
await page.evaluate(src);
measureViewport();
```

It reports — content width, page overflow, control heights, and any element
whose box exceeds the viewport. Page-level horizontal overflow is a defect;
a table scrolling inside its own container is not.
