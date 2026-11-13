# clor.in art brief

Pictures the site needs to look as rich as the reference (azure.microsoft.com). That site's colour
comes from its pictures: every card and band carries a bright 3D render or a photo. The layout and
colour system are built; these files drop into the places named below.

## Rules for every picture

- **One style for all 3D renders**: soft glossy 3D objects, rounded edges, studio lighting, slight
  glass and frosted plastic, no text, no logos, no people.
- **CLOR colours only**: deep navy `#0B1530` background, Blaze Orange `#FF5400` as the main object
  colour, with amber `#FFB627`, cyan `#12B5E5`, coral `#FF7A66` and indigo `#3D4FE0` as accents.
- **No words inside pictures**: the site puts the words on top.
- **Format**: PNG or WebP, sRGB, at the size given (2x). Do not crop tight: leave margin.
- **Photos**: Indian corporate office, natural light, nobody repeated between pictures, no brand
  names visible, screens blank or green (CLOR screens are added afterwards).
- Put the files in one folder with the file names below and send the folder.

Paste this in front of every 3D prompt so the set matches:

> Soft glossy 3D render, rounded shapes, frosted glass and matte plastic, studio lighting with gentle
> rim light, deep navy #0B1530 background, objects in orange #FF5400 with amber #FFB627, cyan #12B5E5
> and coral #FF7A66 accents, no text, no letters, no logos, no people, clean and minimal, high detail.

## A. Must have (the page looks unfinished without these)

| # | File name | Size | Where it goes | Prompt (after the style line) |
|---|---|---|---|---|
| A1 | `hero-art.png` | 2400 x 1400 | Home hero, right half | Wide scene. Left 45% empty navy. On the right, three nested glowing rounded-rectangle neon tubes in orange, amber and cyan curving out of frame, with a floating glass panel in the middle. |
| A2 | `card-attendance.png` | 1200 x 675 | Home highlight card 1 | A fingerprint reader device with a glowing green tick, a small clock and a row of rounded day tiles floating beside it. Amber accents. |
| A3 | `card-payroll.png` | 1200 x 675 | Home highlight card 2 | A phone standing upright showing a blank payslip card, with rupee coins and a small wallet floating beside it. Cyan accents. |
| A4 | `card-people.png` | 1200 x 675 | Home highlight card 3 | A stack of employee profile cards with round avatar discs, a folder and a badge on a lanyard. Coral accents. |
| A5 | `feature-books.png` | 900 x 1300 (tall) | Home products band, the tall Books card | Tall scene. A ledger book, a stack of invoices with a seal, and a calculator, floating upward. Indigo and orange. Bottom 40% dark and empty for words. |
| A6 | `icon-books.png` … `icon-timesheet.png` (6 files) | 512 x 512, transparent | Product icon everywhere: menus, cards, page heads | One 3D app icon each on a rounded-square tile, front view, transparent background: Books (open ledger, indigo), Payroll (wallet with rupee coin, cyan), People (two round figures, coral), Attendance (fingerprint, amber), Projects (kanban board, teal `#22C3B3`), Timesheet (stopwatch, slate blue `#8A97B5`). |

## B. Should have (lifts the rest of the page)

| # | File name | Size | Where it goes | Prompt or description |
|---|---|---|---|---|
| B1 | `bg-corner-1.png`, `bg-corner-2.png`, `bg-corner-3.png` | 1000 x 1000, transparent | Corners of the pale bands | Thin-line wireframe shapes on a transparent background, no fill: a wireframe sphere, a wireframe prism stack, a glass cube cluster. Line colours orange, amber and cyan. |
| B2 | `next-trial.jpg` | 1400 x 1000 | "Take the next step", wide card | Photo: two colleagues at a desk looking at a laptop together, modern Indian office, laptop screen plain green. |
| B3 | `next-demo.jpg` | 1300 x 560 | "Take the next step", demo card | Photo: a salesperson on a video call wearing a headset, smiling, side view, screen not visible. |
| B4 | `next-guides.jpg` | 1300 x 560 | "Take the next step", guides card | Photo: a person reading on a laptop with a notebook and coffee, calm, over the shoulder, screen plain green. |
| B5 | `sol-owner.jpg`, `sol-firm.jpg`, `sol-finance.jpg`, `sol-hr.jpg` | 1600 x 1000 each | Solutions tabs | Four photos in one look: a business owner at her desk; a chartered accountant with files and a laptop; a finance team of two reviewing figures; an HR manager talking with a new joiner. Screens plain green. |
| B6 | `band-data.png` | 2400 x 800 | Navy "Mumbai region" band background | Wide, dark. A glass server block with a shield and a padlock, far right, low contrast, left 60% empty navy. |

## C. Nice to have

| # | File name | Size | Where it goes | Description |
|---|---|---|---|---|
| C1 | `head-books.png` … `head-attendance.png` (4 files) | 1600 x 1000 | Each product page head, right side | The 3D render of that product from A2 to A5, wider, in that product's colour. |
| C2 | `head-pricing.png`, `head-security.png`, `head-integrations.png`, `head-company.png` | 1600 x 1000 | Other page heads | Price tags and coins; shield and lock; connected plugs and cables; an office building model. |
| C3 | Real screenshots | 2400 wide | Replace the drawn sample screens | Books invoice, GSTR-1, People employee record, Attendance month, Payroll pay run, from a demo company with made-up names. |
| C4 | Customer logos and one-line quotes | SVG logos | A customer stories band (not on the page yet) | Only real customers who agreed in writing. |
| C5 | Short screen recording | 1920 x 1080, 15 to 30 s, no sound | Hero or "Inside each app" | One real task from start to finish, for example raising an invoice. |

## Not needed

- Fonts (Plus Jakarta Sans is already in), the CLOR logo, stock icons for buttons and menus.

## D. Sign-in pictures (app, not the site)

Where things stand on 13 Nov 2026:

| Door | Address | Picture today |
|---|---|---|
| Workspace | app.clor.in | The door with four coloured panels (`signin-workspace`). Has one. |
| Books, People, Payroll, Attendance | each app's own address | One 3D picture each. Have one. |
| Sign up, trial | /signup, /start | Building-blocks picture. Has one. |
| Operator console | ops.clor.in | No picture file. A scene drawn in code on navy: the console behind a lock, an authenticator code, an audit trail. |

Wanted, in the same 3D clay style as the pictures above, 1536 x 1536 (and a 960 copy), WebP:

| # | File name | Scene |
|---|---|---|
| D1 | `signin-ops-1536.webp`, `signin-ops-960.webp` | A CLOR staff member at a control desk with three screens showing plain shapes (no words, no customer names), a large padlock and a shield beside the desk, a phone showing six dots for an authenticator code. Navy room, orange and cyan light. |
| D2 | `signin-workspace-1536.webp` (optional replacement) | The same door, but with **no title painted into the picture**: today's pictures carry "Clor Applications Pvt Ltd", and the registered name is CLOR Applications Private Limited. The page can set the title in type instead, so it is always right. |
| D3 | All other sign-in pictures, re-exported without the painted title | Same reason as D2. |

Rules: no words or logos inside the picture, no real people, nobody repeated from another picture, leave the bottom-left corner calm (the quote card sits there).
