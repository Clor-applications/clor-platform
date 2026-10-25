# WF-06 — Employee operations and effective-dated history

## Standard operation pattern
Entry from employee profile More / directory row action → summary of current state → proposed change form → applicable impact/reason/effective date → permitted checker/approval route → confirmation → event in Activity and effective-dated History → integration outbox as appropriate. If approval pending, do not change authoritative effective state prematurely.

| Action | Required inputs | Validation & approvals | Outcome |
|---|---|---|---|
| Change Manager | new manager, effective date, reason optional per policy | self/cycle checks, company scope, approval if policy | effective-dated reporting relationship; pending approval re-evaluation |
| Transfer Department | destination dept/location/branch where needed, effective date, reason | active scoped values, mapping continuity, transfer permission | old and new assignment snapshots |
| Change Designation / Promotion | new title/grade, effective date, reason | work level and payroll impact detection, applicable approval | employment event; downstream proposal only |
| Change Employment Type | new type, start/effective date, supporting agreement | policy, date overlap, legal approval | new episode/version if model warrants |
| Probation / Confirmation | confirm/extend, reason, effective date | workflow, due date, reviewer separation | durable decision; never auto-confirm by timer alone |
| Set Status | allowed next state, effective date, reason | state-machine enforcement, impact notice | audit & lifecycle handoff |
| Archive/Reactivate | confirmation, reason, scoped permission | retention, payroll/attendance references, appropriate reversible state | hide from active default without hard-delete |
| Rehire | prior worker reference, new employment episode | dedupe/mapping rules, no ID overwrite | preserve historical episode |
| Link Portal User | verified identity, authorization | proof of ownership and access policy | user↔employee association, audit |

## History design
Show chronological employment timeline with effective date and recorded timestamp. Group events by employment episode; supporting attachments visible only to permitted users. Include `Compare before/after`, origin `HR/manual/import/integration`, approval status, event reason, related workflow ID. Distinguish job history from technical system audit. Retroactive corrections append a correcting event, never rewrite past event secretly.

## State transition requirements
Status names and allowed transitions **must come from approved PRD and existing enums**, not guessed hardcoded UI lists. UI filters out impossible destinations but server independently rejects them. Any locked payroll period must not be retroactively mutated; downstream payroll adjustments are proposed with source version and human approval.

## Failure cases
Manager selected then changes company before submit: reject and require new scoped lookup. Target dept archived: field error. Same employee edited by another HR admin: 409 compare state. Workflow submitted with no approver: safe pending escalation queue, not silent autoapproval. Partial downstream outage: People change remains auditable, integration status pending/retry rather than pretending Payroll updated.
