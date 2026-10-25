# Workspace UI/UX

- Palette (decision D-3): the Workspace screens built for it (home, Members, Invitations, Account activity) use `apps/admin/src/screens/workspace.css`, scoped to `.ws`: porcelain #FAFAF7, white, stone #F4F3EF, graphite #252626, muted #70736F, lines #E5E6E1, Blaze Orange #F45A28 for the one primary action. Other screens and apps keep DESIGN.md.
- Light only, one logo (clor.in mark and wordmark).
- Home: greeting, company, account role; setup checklist for owners/admins from real data; app cards (Switched on / Access not assigned / Not switched on / Not on your plan) and an "On the way" line for unbuilt apps; Administration and Support groups stacked in columns. Fits one 1440×900 screen.
- States: no app access, not found, access denied (names the permission), empty lists, loading, errors from the server shown as said.
- Phone: header fits 360 px; help lives in the Support group there.
- Each destructive act is confirmed and separate (suspend, remove from company, sign out everywhere).
