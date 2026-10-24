# A-42 browser check (local dev, 2026-10-24)

The document upload's file picker cannot be driven in the browser pane, so the screen's own request was sent from the app page, signed in as the A03 owner, to `POST /api/orgs/<A03>/people/employees/<Advance Taker A39>/documents`:

| Upload | Result |
|---|---|
| `data:image/png` whose bytes are an HTML page with a script | **400** "That file is not what its name says. Upload the PDF, picture or document itself." |
| `data:application/pdf` whose bytes start `MZ` (a Windows program) | **400**, same message |
| a real 1×1 PNG | 201 |
| a real PDF (`%PDF-1.4`) | 201 |

Before the fix both disguised files were stored with the type they claimed (`before-fix.txt`: 201 where 400 expected). Compliance evidence uploads use the same check (`services/fileType.ts`).
