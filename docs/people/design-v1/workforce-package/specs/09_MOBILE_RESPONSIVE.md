# WF-09 — Mobile, tablet, responsive details

## Breakpoint strategies (implementation may adapt to existing design system)
- ≥1280px: global rail + local sidebar visible; table expands in available workspace; optional profile context rail.
- 1024–1279px: keep shell behavior from shared Clor; no hard-coded content minimum width that causes horizontal page scrolling.
- 640–1023px: collapse People navigation as shared shell intends; table prioritized columns; filters in sheet.
- <640px: compact People header; Workforce list cards; full-screen edit/import steps; bottom-sheet filters; minimum 44px tap targets where practical.

## Mobile directory card
First line name + status; secondary line Employee ID, designation; department + location; ellipsis with permitted actions; tapping card navigates except inner controls. Search remains easy to access. Filters show active chip count; bottom `Apply (N results)` only when reliable count available. Bulk selection enters explicit `Select` mode; never hide controls in hover-only overlay.

## Mobile profile
Sticky or scrollable tabs `Overview, Personal, Employment, Organization, Documents, History, Activity`. Header compact with back, employee name/ID, More. Sensitive personal data masked. Each section uses labelled rows with meaningful overflow actions. `Edit` may open full-screen form; audit lives in one full tab instead of cramped right context rail. Consider sticky CTA only if it cannot cover fields when virtual keyboard opens.

## Mobile forms
One field per line, grouped section titles, expand search selectors as bottom sheets/full-screen list; clear keyboard-friendly labels, `Next` input action where appropriate, in-step validation, sticky footer that adapts to on-screen keyboard and safe areas. `Back` retains entered values. Photo/document upload from browser capability only; respect denial/cancellation and don't promise native camera integration unless supported.

## Accessibility / ergonomics
- Android/iOS browser testing, 360×800 and 390×844 as minimum references, landscape and 200% text scaling.
- Labels stay visible on focus; tappable error links; document upload can be operated without drag/drop.
- VoiceOver/TalkBack focus order, keyboard tab order and sheet dismissal tested.
- Virtualized lists announce loading / item count; avoid expensive avatar image loading on metered networks.
- Offline page retains read-only previously loaded information only according to storage/privacy policy; no sensitive caching by default.

## Browser/mobile events
Rotate phone mid-wizard → state intact. Keyboard opens near bottom CTA → field scrolled above keyboard. Switch app away/back → no duplicate submit. Poor 3G network → skeleton then recoverable Retry. Pull-to-refresh if implemented uses real API; no implicit destructive reset. Company switched on desktop while mobile tab still open → server reauthorizes next request and cache invalidation triggers.
