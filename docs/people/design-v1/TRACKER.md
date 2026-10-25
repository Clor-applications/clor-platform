# People design v1 tracker

Gates: G1 Functional · G2 Visual · G3 Implementation · G4 Acceptance. A step is DONE only with evidence for all four.
Status: TODO · IN PROGRESS · DONE · BLOCKED (owner decision).

| Step | Item | G1 | G2 | G3 | G4 | Status | Evidence |
|---|---|---|---|---|---|---|---|
| A | Source audit, mapping, plan | ✓ | – | – | – | DONE | `00-SOURCE-AUDIT-AND-PLAN.md` |
| A.1 | Security fixes found by the audit (hashes, write scope, bulk loop) | ✓ | – | ✓ | ✓ | DONE | 934cc38, 2d6f285 |
| 00.1 | Rose palette: graphite rail, canvas/ink, reduced motion, dark tokens | ✓ | ✓ | ✓ | ✓ | DONE | `palette.test.js`, `design-rules.test.js` 8/8; `evidence/00.1/` |
| 00.2 | Shell params in URL, People mobile tabs, boundary retry | ✓ | ✓ | ✓ | ✓ | DONE | `split-navigation.test.js` (4 new); browser: `s.*` params survive load, company switch clears them; `evidence/00.2/`. Note: the shell's desktop breakpoint is 1100px (spec says 1024); kept, since the spec says to preserve the shared collapse behaviour |
| 00.3 | SearchField, DatePicker, Tabs, Alert, ErrorState, ActivityTimeline, breadcrumb | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `people-design-components.test.jsx` 13/13 (debounce, Enter, Escape, IME, tab keys, date parse/min/grid keys, error kinds, redaction, filters). Visual and acceptance evidence come when screens use them (01.x) |
| 00.4 | Drawer and Modal focus/dirty fixes | ✓ | ✓ | ✓ | ✓ | DONE | `people-design-components.test.jsx` (3 new): focus returns, Escape closes an inner date picker first, dirty scrim/backdrop ignored, Escape asks before discarding. Full web suite 54 failing, all Accounting/baseline (main reported 57) |
| 00.5 | DataTable | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `people-design-components.test.jsx` (3): server sort with aria-sort, 25/50/100 paging, row click vs controls, keyboard row menu, page selection, columns and density. Visual and 375px proof with EMP-01 |
| 00.6 | Application state kit | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `useRequest` (first load, background refresh keeping data, slow flag, failure keeping data, newest answer wins, cancel), `useOnlineHint`, `ErrorState` kinds, `Alert`; test in `people-design-components.test.jsx`. Each state shown on EMP screens in 01.x |
| 01.1 | Backend: sort/filters/counts, version + 409, preferred name, ID suggestion, drafts, server export | ✓ | – | ✓ | ✓ | DONE | `peopleWorkforce.test.ts` 5/5; neighbours 55/55; route gate 0 violations |
| 01.2 | EMP-01 Directory, EMP-12 Saved views | | | | | TODO | |
| 01.3 | EMP-02 Add Employee wizard | | | | | TODO | |
| 01.4 | Record page, EMP-03..06 | | | | | TODO | |
| 01.5 | EMP-07 Documents, EMP-08 History | | | | | TODO | |
| 01.6 | EMP-09 Activity | | | | | TODO | |
| 01.7 | EMP-10 Import, EMP-11 Bulk results | | | | | TODO | |
| 01.8 | Mobile, company switch, accessibility | | | | | TODO | |
| 01.9 | Completion report | | | | | TODO | |

Workflow tests (spec §8): 1 directory round trip · 2 wizard back keeps fields · 3 invalid save then one submit · 4 network failure keeps input · 5 designation change on timeline · 6 company switch leaks nothing · 7 mobile with touch and keyboard.

## Workforce package (owner, 26 Oct 2026)

The owner sent `Clor_People_Workforce_Complete_Package.zip` with "remaining module finish everything".
It is filed under `workforce-package/` and refines Module 01 as **Workforce**: the visible label
`Employees` becomes `Workforce`; employment operations (WF-12..14), the import wizard, export
scopes, bulk jobs (WF-15..17), and an audit timeline with comments (WF-18..19) join the scope.
Its acceptance list `workforce-package/checklists/workforce_acceptance.csv` is tracked here by
WF id alongside the steps above. Its "stop at each phase" rule is overridden by the owner's
instruction to finish everything; each phase still lands with tests and evidence.

## Decisions in force (26 Oct 2026)

Owner said "start building" (relayed by the main session) without answering D-V1..D-V9, so each runs on its recommendation until the owner says otherwise — the same rule as D-02..D-10 (OD-10).

| ID | Running as |
|---|---|
| D-V1 | People dark tokens built and contrast-tested; the platform theme switch stays light-only |
| D-V2 | Spec's 7 profile tabs; Statutory is a permission-gated section of Personal; Requests and Tasks as Overview "Open items" |
| D-V3 | Work relationship = Employee type + Contractor; no new field |
| D-V4 | People's rail graphite, colour tokens only in the rose palette |
| D-V5 | Canvas `#F6F4F2` and ink `#232226` in the rose palette only |
| D-V6 | Radius stays 4px (Accounting geometry) |
| D-V7 | Shell writes screen params to the URL (shared change, told to the main session) |
| D-V8 | Platform AuditLog gains a correlation id (platform migration, told to the main session) |
| D-V9 | Directory banners from live Data Health and checklist counts, dismissible per user |
