# Team work logs

One file per agent: `<agent name>.md`, for example `clor-coder-people.md` or `clor-qa-employee.md`. One file each,
so two agents never edit the same log.

After every task, the agent adds an entry **at the top** of its own file:

```
## 2026-10-30 14:20 IST — People / Talent — batch 2
- Did: what was done, in one or two lines
- Evidence: PR #, commit, test run (N passed), screenshot or report path
- Next: what this agent does next
- Blocked on: who or what, or "nothing"
```

Rules:
- Facts only, no filler. A claim without evidence is written as unverified.
- Never put passwords, tokens, personal data or the banned names in a log.
- The module's status lives in its tracker. The log says who did what and when.
- The coordinator reads the logs to report to the owner, and summarises them daily in `clor-coordinator.md`.
