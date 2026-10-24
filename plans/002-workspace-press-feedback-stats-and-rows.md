# 002 — Press feedback on clickable stat tiles and quick-action rows

- **Status**: DONE
- **Commit**: 2825f4e
- **Severity**: LOW
- **Category**: Missed opportunities (feedback)
- **Estimated scope**: 1 file (`apps/admin/src/screens/workspace.css`), ~12 lines

## Problem

Buttons (`.ws-btn`) nudge down 1px when pressed (`workspace.css:115`), but the other clickable surfaces on the Overview do not react to a press at all: the stat tiles that open a page (`button.ws-stat`) and the quick-action rows (`.ws-row`). A click on them gives no confirmation until the next page draws.

```css
/* apps/admin/src/screens/workspace.css:554 — current */
button.ws-stat {
  cursor: pointer;
  transition: border-color 0.18s var(--ws-ease), box-shadow 0.18s var(--ws-ease);
}
```

```css
/* apps/admin/src/screens/workspace.css:434 — current (excerpt) */
.ws-row {
  ...
  cursor: pointer;
  transition: background-color 0.15s var(--ws-ease);
}
```

## Target

A near-imperceptible scale on press — these are clicked tens of times a day, so it must stay subtle and fast.

```css
/* target */
button.ws-stat {
  cursor: pointer;
  transition: border-color 0.18s var(--ws-ease), box-shadow 0.18s var(--ws-ease), transform 120ms var(--ws-ease);
}
button.ws-stat:active {
  transform: scale(0.985);
}
.ws-row {
  /* …unchanged properties… */
  transition: background-color 0.15s var(--ws-ease), transform 120ms var(--ws-ease);
}
.ws-row:active {
  transform: scale(0.985);
}
```

## Repo conventions to follow

- Exemplar: `.ws-btn:active { transform: translateY(1px); }` at `workspace.css:115` — press feedback is a single `:active` rule next to the element's base rule, using `var(--ws-ease)`.

## Steps

1. In `button.ws-stat` (line ~554), append `, transform 120ms var(--ws-ease)` to the `transition` list.
2. Directly after the `button.ws-stat:hover` rule, add `button.ws-stat:active { transform: scale(0.985); }`.
3. In `.ws-row` (line ~434), change `transition: background-color 0.15s var(--ws-ease);` to `transition: background-color 0.15s var(--ws-ease), transform 120ms var(--ws-ease);`.
4. Directly after the `.ws-row:hover` rule, add `.ws-row:active { transform: scale(0.985); }`.

## Boundaries

- Only `apps/admin/src/screens/workspace.css`. No markup changes.
- Do NOT use a scale below 0.98 — these are high-frequency.
- If plan 001 has landed, its reduced-motion block already cancels `:active` transforms; do not add another one.

## Verification

- **Mechanical**: `npx vitest run apps/admin` → pass; `npx vite build` → builds.
- **Feel check** on `?app=admin&open=home`: press and hold a stat tile (Companies) — it shrinks very slightly and springs back on release; same for "Create company" in Quick actions. In DevTools Animations at 10% the scale is visible but small; at full speed it should feel like a click, not an animation.
- **Done when**: both surfaces have an `:active` transform of exactly `scale(0.985)` at 120ms.
