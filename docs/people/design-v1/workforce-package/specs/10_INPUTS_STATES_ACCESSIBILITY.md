# WF-10 — Keyboard, hover, state machine, failures, accessible UX

## Interaction map
| Interaction | Expected response | Edge case |
|---|---|---|
| Hover interactive row | subtle highlight; no column shift | touch devices never rely on hover |
| Click outside combobox | dismiss suggestions; preserve typed value per control policy | nested calendar click must not count as outside |
| Press Escape | dismiss top-most popup; focus returns to trigger | unsaved modal does not discard data silently |
| ArrowDown / ArrowUp in listbox | move active option | virtualized option IDs available to AT |
| Enter in combobox | select active option, close and announce | IME composition must not accidentally select |
| Enter in search | commit search | no form submit |
| Enter in textarea | newline | not submit |
| Enter in multistep text field | never create employee implicitly | focused Next button still works |
| Tab / Shift+Tab | logical focus order | modal trap only for modal dialog |
| Click row checkbox | select only | must not open profile |
| Clear input | clear itself, re-query as appropriate | other filters intact |
| Open second menu | dismiss incompatible first menu | prevent overlay stacking |
| Save repeated click | single request/idempotency | show loading/disabled not frozen |
| Close dirty edit | confirm Discard / Stay / Save Draft if supported | browser unload protection where available |
| Switch company | clear scoped list, selected rows, caches, drawers, events | fail closed on stale token |
| 409 conflict | present comparison, allow review/reload | no silent overwrite |
| 401 expired | login/recover authorized draft state | no leaking content to other session |
| 403 denied | restricted screen, safe backlink | no hidden record hints |
| 404 missing | friendly not found | no sensitive difference vs unauthorized |
| 429 rate limited | preserve filters/draft, obey Retry-After | avoid retry storm |

## State inventory
Initial loading skeleton; refresh retaining last known non-sensitive data; truly empty; filtered no results; loading filter options; no search matching; image fallback; missing employee avatar; permission-hidden action; disabled by unsubscribed module; offline hint; actual API unreachable; server error with reference ID; 401 expired session; 403 forbidden; 404; 409 conflict; 422 validation; 429 throttle; upload rejected/scan pending; import in progress/partial failure; export expired; save optimistic rollback; realtime stale data; background job failed; deactivated employee; missing integration entitlement. Each state needs explicit copy, CTA, retry policy and preservation statement.

## Error templates
- **No internet connection:** `Check your connection and try again.` Buttons `Retry`, optional `Back`; don't claim no internet from `navigator.onLine` alone.
- **Slow connection:** `Still loading employee records…` show skeleton or retained list, without timeout guess. Button Retry only if idempotent.
- **Could not save:** `Your changes have not been saved. They are still available in this form.` Button `Try again` and cancel with guard.
- **Permission restricted:** `You don’t have access to this employee record.` `Back to Workforce`.
- **No employees yet:** `Add the first employee to start your workforce directory.` `Add Employee` only when authorized.
- **No matches:** `No employees match these filters.` `Clear filters`.
- **Conflict:** `This employee record was updated elsewhere. Review changes before saving.` `Compare`, `Refresh`.

## Visual/accessibility acceptance
WCAG 2.2 AA target: 4.5:1 for normal text (exceptions per standard), visible focus, semantic labels, aria-expanded and aria-controls, field help `aria-describedby`, live regions for save/loading, keyboard-close dialogs, adequate pointer target spacing. No inaccessible disabled-tooltip-only actions; errors describe how to resolve. Skeleton animations disabled under reduced motion. Prevent layout shift when status badges or inline errors appear.

## Performance guidance
Use targeted queries; avoid fetching all personnel, document metadata or audit trail on first directory render; lazy-load profile tabs. Reasonable loading response; no invented performance SLA. Instrument real-user metrics and error/latency thresholds agreed in testing. Reduce avatars on low bandwidth and cache only policy-allowed data.
