# CLOR Premium Marketing Website — Design Upgrade

**Branch:** `design/clor-premium-motion-2026-11-13`  
**Scope:** `website/` only; no production deployment or customer app changes.

## Design principle

Preserve the actual product content, photos, existing logo, dynamic pricing, SEO metadata, demo validation/submission API, company pages and user authentication destinations. Upgrade their presentation rather than replacing it with generic SaaS claims or invented numbers.

## Implemented in this branch

- `src/styles/premium.css`: typography hierarchy, premium mist backgrounds, restrained orange highlights, dimensional but accessible background grids, responsive section spacing, depth and hover feedback, dark header/CTA polish, product/plan card upgrades, and reduced-motion behavior.
- `src/components/Premium.jsx`: a linked application ribbon and a connected-workflow presentation using original product names/accent colors; no fake usage figures.
- `src/pages/Home.jsx`: a small eyebrow, dimensional hero-photo callouts, product ribbon and connected-suite visual section while leaving core claims and original working links intact.
- `src/App.jsx`: loads the new CSS as an additive override; existing theme remains available for reference.
- `motion/`: standalone, editable Remotion source for 7-second hero and 9-second connected-suite clips, not downloaded by production visitors and not yet rendered.

## Page-by-page design direction

| Existing page(s) | Upgrade | Preserve |
| --- | --- | --- |
| Home | Large editorial hero, subtle gridded depth, photos + product proof, connected app visual, compressed section rhythm, deliberate reveal motion | Existing hero text, product catalogue, sample UI windows, setup, FAQ, CTAs |
| /products and /products/{books,people,payroll,attendance} | Stronger titles, dimensional photo panels, accent-specific details, cards and more effective dense feature layouts | Product descriptions, screenshots, workflow, statuses, connections, links |
| /products/{projects,timesheet} | Polished coming-soon presentation with explicit status | No misleading launch date or active-product claims |
| /solutions/businesses and /solutions/accounting-firms | More readable editorial hero and explanation cards | Current solution content and access model |
| /pricing | Refined price cards, highlighted option, billing-period control | Published operator-console pricing API and fail-safe absence of prices |
| /integrations and /resources | Tightened section rhythm, interactive visual hierarchy | Real integration status; don't overpromise connectors |
| /company/about and /company/team | More crafted typography and profile treatment | Company and team biographies / actual images |
| /demo and /contact | Clearer form spacing, field focus, submission/success/error feedback | Form fields, validation, consent, anti-spam behavior, API handlers |
| /security and /status | Clean high-trust documentation and incident/status presentation | Accurate security description and live status data |
| /legal/* | Readable narrow-column document typography, no decorative animation | Text and document structure unchanged |
| Shared header/footer | Dark navy contrast, refined dropdowns/buttons, spacing and hover feedback | All destination links and accessibility behavior |

## Acceptance criteria before merging

1. Build `website/` using its existing `npm ci && npm run build` pipeline (pricing prefetch is allowed to fall back gracefully).
2. Confirm every prerendered `ROUTES` path from `src/routes.jsx` works by direct refresh; do not convert to a one-page-only site.
3. Test navigation and keyboard/focus behavior, screen-reader flow, and mobile navigation at 360, 390, 768, 1024 and 1440px.
4. Check product images/photography do not crop text or block CTAs; avoid unintended clipping from absolute visual elements.
5. Verify demo form validations, submission API, pricing monthly/yearly switch, signup and sign-in URLs.
6. Run Lighthouse mobile and desktop; maintain LCP under 2.5 seconds for a representative fast connection, CLS under 0.1 and INP under 200ms where measurable. Audit image and font sizes.
7. Verify reduced-motion preferences and touch-only devices: no pointer-dependent content or continuously moving essential elements.
8. Do not ship the optional Remotion assets without rendering, compressing, creating poster/fallback, and validating mobile cost.

**Important:** All enhancements on this branch are code changes; a real build/test or live-site visual QA has not yet been performed. Keep the main branch and live deployment unchanged until reviewed.
