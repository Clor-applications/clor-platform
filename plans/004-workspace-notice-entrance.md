# 004 — Ease in the one-line confirmation notice

- **Status**: DONE
- **Commit**: 2825f4e
- **Severity**: LOW
- **Category**: Missed opportunities (preventing a jarring change)
- **Estimated scope**: 1 file, ~8 lines

## Problem

After an action ("Invitation sent to …", "Withdrew the invitation …"), `.ws-notice` appears instantly above the table and shoves the table down in a single frame.

```jsx
// apps/admin/src/screens/Invitations.jsx:119 — current
{notice ? <p role="status" className="ws-notice">{notice}</p> : null}
```

```css
/* apps/admin/src/screens/workspace.css:1269 — current */
.ws-notice {
  padding: 10px 14px;
  border-radius: 8px;
  background: rgb(var(--ws-accent-soft));
  color: rgb(var(--ws-ink));
  font-size: 0.875rem;
}
```

## Target

An entry-only transition using `@starting-style` (no JS): opacity 0 → 1 and a 4px drop, 200ms ease-out. No exit animation — the notice is replaced or cleared, not dismissed.

```css
/* target */
.ws-notice {
  /* …existing properties… */
  transition: opacity 200ms var(--ws-ease), transform 200ms var(--ws-ease);
}
@starting-style {
  .ws-notice {
    opacity: 0;
    transform: translateY(-4px);
  }
}
```

## Repo conventions to follow

- Motion in `workspace.css`, easing `var(--ws-ease)` (`cubic-bezier(0.2, 0.7, 0.2, 1)`).

## Steps

1. Add the `transition` line to `.ws-notice` (line ~1269).
2. Directly after the rule, add the `@starting-style` block from Target with the comment `/* A confirmation eases in instead of shoving the page down in one frame. */`.

## Boundaries

- CSS only; do not change `Invitations.jsx` or any other screen.
- `.ws-notice` is also used for the access preview inside the invite drawer (`Invitations.jsx:220`); that preview re-renders text in place without remounting, so it will not re-animate on every keystroke — confirm this in the feel check, and STOP if it does.

## Verification

- **Mechanical**: `npx vitest run apps/admin` → pass.
- **Feel check**: on `?app=admin&open=invitations`, withdraw or resend an invitation: the confirmation fades down into place. Open "Invite people" and change the role several times: the preview line updates without flickering or re-animating. Browsers without `@starting-style` simply show it instantly.
- **Done when**: the notice eases in on appearance and nothing animates on text updates.
