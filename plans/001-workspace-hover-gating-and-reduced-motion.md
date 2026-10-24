# 001 — Gate Workspace hover motion to real pointers; keep opacity feedback under reduced motion

- **Status**: DONE
- **Commit**: 2825f4e
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`apps/admin/src/screens/workspace.css`), ~25 lines

## Problem

Three hover rules move things with `transform`, and none is gated to devices that really hover. On a phone, a tap fires `:hover` and leaves the element shifted until the next tap elsewhere.

```css
/* apps/admin/src/screens/workspace.css:208 — current */
.ws-link svg {
  transition: transform 0.18s var(--ws-ease);
}
.ws-link:hover svg {
  transform: translateX(3px);
}
```

```css
/* apps/admin/src/screens/workspace.css:293 — current (the app cards on the Overview) */
.ws-card.is-open:hover {
  border-color: rgb(var(--ws-muted) / 0.45);
  box-shadow: 0 18px 36px -24px rgb(var(--ws-ink) / 0.35);
  transform: translateY(-2px);
}
```

```css
/* apps/admin/src/screens/workspace.css:466 — current */
.ws-row:hover .ws-chev {
  opacity: 1;
  transform: translateX(2px);
}
```

The reduced-motion block removes every transition, including the colour and opacity fades that are feedback, not movement:

```css
/* apps/admin/src/screens/workspace.css:471 — current */
@media (prefers-reduced-motion: reduce) {
  .ws *,
  .ws *::before,
  .ws *::after {
    transition: none !important;
  }
}
```

## Target

- The three `transform` hover effects apply only inside `@media (hover: hover) and (pointer: fine)`. Colour, border and shadow changes on hover stay ungated (they do not move anything).
- Under `prefers-reduced-motion: reduce`, no element moves (`transform: none` on hover/active), but colour, border, shadow and opacity transitions remain, shortened to 120ms.

```css
/* target, replacing the three hover transforms */
@media (hover: hover) and (pointer: fine) {
  .ws-link:hover svg {
    transform: translateX(3px);
  }
  .ws-card.is-open:hover {
    transform: translateY(-2px);
  }
  .ws-row:hover .ws-chev {
    transform: translateX(2px);
  }
}

/* target, replacing the reduced-motion block */
@media (prefers-reduced-motion: reduce) {
  .ws *,
  .ws *::before,
  .ws *::after {
    transition-property: color, background-color, border-color, box-shadow, opacity !important;
    transition-duration: 120ms !important;
  }
  .ws *:hover,
  .ws *:active {
    transform: none !important;
  }
}
```

## Repo conventions to follow

- All Workspace motion lives in `apps/admin/src/screens/workspace.css`, scoped under `.ws` or `.ws-*` classes. Easing is `var(--ws-ease)` = `cubic-bezier(0.2, 0.7, 0.2, 1)`; keep using it.
- Comments above a rule say why, in a sentence (see the comment above `.ws-table-wrap` at line ~710).

## Steps

1. In `.ws-link:hover svg` (line ~211), delete the rule. Keep `.ws-link svg { transition: … }` as is.
2. In `.ws-card.is-open:hover` (line ~293), delete only the `transform: translateY(-2px);` line; keep the border-color and box-shadow.
3. In `.ws-row:hover .ws-chev` (line ~466), delete only the `transform: translateX(2px);` line; keep `opacity: 1;`.
4. Directly after the `.ws-row:hover .ws-chev` rule, add the `@media (hover: hover) and (pointer: fine)` block from Target, with the comment `/* Movement on hover only where hovering is real; a tap on a phone fires :hover and leaves things shifted. */`.
5. Replace the whole `@media (prefers-reduced-motion: reduce)` block (line ~471) with the reduced-motion block from Target, with the comment `/* Reduced motion: nothing moves, but colour and opacity feedback stays. */`.

## Boundaries

- Do NOT touch any file other than `apps/admin/src/screens/workspace.css`.
- Do NOT change colours, durations or easing of any other rule.
- Do NOT gate colour/border/shadow hovers — only the three transforms.
- If a quoted rule does not match the file (drift since 2825f4e), STOP and report.

## Verification

- **Mechanical**: `npx vitest run apps/admin` → all pass. `npx vite build` → builds.
- **Feel check** (`npm run dev`, open `?app=admin&open=home`):
  - Desktop: hover an app card on the Overview — it still lifts 2px; hover "Manage apps" — the chevron still slides 3px.
  - DevTools device toolbar (touch, iPhone): tap an app card — it does not stay lifted.
  - Rendering panel → emulate `prefers-reduced-motion: reduce`: hovering a card changes its border/shadow with no lift; the quick-action row chevron fades in without sliding; pressing a button does not nudge down.
- **Done when**: no `transform` appears in any `:hover` rule outside the `(hover: hover) and (pointer: fine)` block, and reduced motion keeps opacity/colour transitions.
