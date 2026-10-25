# People design v1 tracker

Gates: G1 Functional · G2 Visual · G3 Implementation · G4 Acceptance. A step is DONE only with evidence for all four.
Status: TODO · IN PROGRESS · DONE · BLOCKED (owner decision).

| Step | Item | G1 | G2 | G3 | G4 | Status | Evidence |
|---|---|---|---|---|---|---|---|
| A | Source audit, mapping, plan | ✓ | – | – | – | DONE | `00-SOURCE-AUDIT-AND-PLAN.md` |
| A.1 | Security fixes found by the audit (hashes, write scope, bulk loop) | ✓ | – | ✓ | ✓ | DONE | 934cc38, 2d6f285 |
| 00.1 | Rose palette: graphite rail, canvas/ink, reduced motion, dark tokens | | | | | BLOCKED (D-V1, D-V4, D-V5) | |
| 00.2 | Shell params in URL, People mobile tabs, boundary retry | | | | | BLOCKED (D-V7) | |
| 00.3 | SearchField, DatePicker, Tabs, Alert, ErrorState, ActivityTimeline, breadcrumb | | | | | TODO | |
| 00.4 | Drawer and Modal focus/dirty fixes | | | | | TODO | |
| 00.5 | DataTable | | | | | TODO | |
| 00.6 | Application state kit | | | | | TODO | |
| 01.1 | Backend: sort/filters/counts, version + 409, preferred name, ID suggestion, drafts, server export | | | | | TODO | |
| 01.2 | EMP-01 Directory, EMP-12 Saved views | | | | | TODO | |
| 01.3 | EMP-02 Add Employee wizard | | | | | TODO | |
| 01.4 | Record page, EMP-03..06 | | | | | BLOCKED (D-V2) | |
| 01.5 | EMP-07 Documents, EMP-08 History | | | | | TODO | |
| 01.6 | EMP-09 Activity | | | | | BLOCKED (D-V8) | |
| 01.7 | EMP-10 Import, EMP-11 Bulk results | | | | | TODO | |
| 01.8 | Mobile, company switch, accessibility | | | | | TODO | |
| 01.9 | Completion report | | | | | TODO | |

Workflow tests (spec §8): 1 directory round trip · 2 wizard back keeps fields · 3 invalid save then one submit · 4 network failure keeps input · 5 designation change on timeline · 6 company switch leaks nothing · 7 mobile with touch and keyboard.
