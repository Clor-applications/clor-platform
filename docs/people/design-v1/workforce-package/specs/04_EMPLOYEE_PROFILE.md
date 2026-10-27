# WF-04 — Employee profile and tabs (WF-104/105)

## Header
Breadcrumb `People / Workforce / [employee name]`; back to Directory preserves query. Identity avatar or initials, full name, internal employee number, designation, department, location, manager, status. Never put sensitive IDs, full DOB, bank info or personal document numbers in header. Actions Edit, More, permitted quick workflow; no duplicate profile summary cards.

## Tab contract
| Tab | Key sections | Actions | Important states |
|---|---|---|---|
| Overview | Employee identity, employment summary, organizational assignment, work contacts, actionable alerts | Edit allowed sections, View team, View documents | incomplete profile, joining, suspended, exited |
| Personal | legal/preferred name, contact channels, addresses, emergency contact, approved demographics and identity fields | Request correction/verified edit, add contact | masked sensitive, consent, missing, forbidden |
| Employment | employment episode, status, start/end, type, grade, probation/confirmation, work agreement references | change employment, confirmation via workflow | missing episodes, conflicting effective dates |
| Organization | department, designation, primary and dotted-line manager, location, branch, cost center if enabled | transfer, change manager/designation | invalid manager/circular reference |
| Documents | versioned uploads, type/status, expiry, last review, source | upload, preview, replace, review, download | expired, quarantined, access denied |
| History | time-sliced employment events (effective date vs recorded date), promotions, transfers, status changes | compare snapshots, export if permitted | retroactive correction, backdated event |
| Activity | immutable event timeline with actor, timestamp, field diff and comments/workflow entries | filters, pagination, add comment if allowed | redacted values, unavailable event |

## Field rendering rules
- Single source of truth for each value. Summary tiles deep-link to owning tab rather than duplicating editing forms.
- Every editable section shows `Edit` only for permitted actor and fields. Save server-side validation; auto-merge never silently overwrites newer values.
- Work email vs personal email clear labels and independent privacy controls. Missing is shown as `Not provided` with Add action only when authorized.
- Identity documents show masked last characters where approved, otherwise no value. No government IDs in browser local storage, URLs, analytics, logs or client error messages.
- Dates: locale-aware display, no inferred timezone shift for date-only fields. History states effective date and recorded-on separately.
- Employee with no login has `Portal access not linked` (or existing equivalent), not an error or forced platform account.

## Right-context rail or drawer
At wide desktop widths, optional contextual `Recent activity` or `Action required` (not another copy of profile fields). On smaller widths it becomes a tab/drawer; must never squeeze main profile forms. Do not repeat company switch in profile.

## Unsaved editing / conflict
Per-section dirty state. On 409 conflict show server version and local proposed change, allow authorized compare/reload/resubmit; no blind last-write-wins for employment or sensitive fields. When archive, edit, or company membership revoked during page viewing, disable stale actions, clear restricted cached data and route to safe fallback.

## Profile acceptance probes
Open deep link under wrong company → 404/403 without identity leakage. Manager sees permitted direct reports, not all records. General HR user cannot inspect identity documents via DOM or API. Unauthorized tab cannot retrieve hidden fields in preload. A backdated manager change appears in history without retroactively rewriting approval decisions. Mobile tabs remain keyboard/voice-accessible and fit 360px.
