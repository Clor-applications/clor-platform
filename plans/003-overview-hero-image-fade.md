# 003 — Fade the Overview hero picture in once it has loaded

- **Status**: DONE
- **Commit**: 2825f4e
- **Severity**: LOW
- **Category**: Missed opportunities (preventing a jarring change)
- **Estimated scope**: 2 files, ~15 lines

## Problem

The hero picture (`clor-office.webp`, 50 KB) decodes after the greeting text, so the right 40% of the card pops from empty to a full, saturated illustration.

```jsx
// apps/admin/src/screens/AdminHome.jsx:126 — current
<img src={heroImage} alt="" width="1400" height="559" decoding="async" />
```

```css
/* apps/admin/src/screens/workspace.css:1340 — current */
.ws-hero-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 38% 58%;
  display: block;
}
```

## Target

Opacity only, ease-out, 240ms, starting when the image has loaded. If it is already cached (`complete` on mount), show it with no fade.

```jsx
// target
const [heroReady, setHeroReady] = useState(false);
...
<img
  src={heroImage}
  alt=""
  width="1400"
  height="559"
  decoding="async"
  data-loaded={heroReady || undefined}
  ref={(el) => { if (el?.complete && !heroReady) setHeroReady(true); }}
  onLoad={() => setHeroReady(true)}
/>
```

```css
/* target */
.ws-hero-media img {
  /* …existing properties… */
  opacity: 0;
  transition: opacity 240ms var(--ws-ease);
}
.ws-hero-media img[data-loaded] {
  opacity: 1;
}
```

## Repo conventions to follow

- `useState` is already imported in `AdminHome.jsx` (line 1). Keep state near the other `useState` calls at the top of the component.
- Motion lives in `workspace.css`; easing `var(--ws-ease)`.

## Steps

1. In `AdminHome.jsx`, inside the `AdminHome` component with the other state hooks, add `const [heroReady, setHeroReady] = useState(false);`.
2. Replace the `<img …>` at line ~126 with the target JSX.
3. In `workspace.css`, add `opacity: 0;` and `transition: opacity 240ms var(--ws-ease);` to `.ws-hero-media img`, and add the `.ws-hero-media img[data-loaded] { opacity: 1; }` rule after it, with the comment `/* The picture fades in when it has loaded rather than popping in after the text. */`.

## Boundaries

- Do NOT animate transform or scale on the picture; opacity only.
- Do NOT add a placeholder shimmer or skeleton.
- The `.ws-hero-date` pill must stay visible from the start (it is a sibling, not inside the img) — do not fade it.

## Verification

- **Mechanical**: `npx vitest run apps/admin/src/screens/AdminHome.test.jsx` → pass; `npx vite build` → builds.
- **Feel check**: DevTools Network → "Slow 4G", hard reload `?app=admin&open=home`: the greeting appears, then the picture fades in over ~¼ second. Reload again (cached): the picture is there immediately with no flash of empty space. With `prefers-reduced-motion: reduce` (and plan 001 landed), it still fades — opacity is allowed.
- **Done when**: the image never pops in on a slow load and never blinks on a cached load.
