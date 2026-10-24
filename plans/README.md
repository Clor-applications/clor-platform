# Animation plans — Workspace Overview

Written by `improve-animations` at commit 2825f4e. Each plan is self-contained; run them with any agent or `improve-animations execute <plan>`.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Gate hover motion; gentler reduced motion](001-workspace-hover-gating-and-reduced-motion.md) | MEDIUM | DONE |
| 002 | [Press feedback on stat tiles and quick-action rows](002-workspace-press-feedback-stats-and-rows.md) | LOW | DONE |
| 003 | [Fade the hero picture in once loaded](003-overview-hero-image-fade.md) | LOW | DONE |
| 004 | [Ease in the confirmation notice](004-workspace-notice-entrance.md) | LOW | DONE |

**Order**: 001 first (it rewrites the reduced-motion block the others rely on), then 002, 003, 004 in any order. All four touch `apps/admin/src/screens/workspace.css`, so run them one after another, not in parallel.

**Already right, leave alone**: `.ws-btn:active` 1px nudge (120ms); drawers' slide-in (`ui-in-right`, shared); no animation on rail/module navigation, page changes, stat counts, tab switches or the audit-trail Details disclosure.
