# CLOR Visual V2 — Photo-first compact grid
Design iteration: 13 Nov 2026
Branch: design/clor-premium-motion-2026-11-13
Status: design code committed; not deployed.

## Changes made
- Existing CLOR product photography is preserved. Homepage now loads an original Books office photo plus People, Attendance and Payroll photo cards from /people/ under the site's public assets.
- The hero is a layered, photo-led CSS sequence with a working pause/play button, semantic HTML, accessible image descriptions and reduced-motion fallbacks.
- White space is styled as shallow perspective 3D grid, not replaced with blank rectangles.
- Shared vertical section spacing, product cards, typography, header, pricing panels, feature lists, subpages, footers and connected workflow blocks are compacted.
- Duplicate connection-summary band was removed from the homepage to eliminate repeated content; the connected-workflow visual remains.
- website/motion/src/PhotoHero.jsx is an optional original Remotion composition built from the four existing image files. Rendering is not required to build the website and has not yet been done.
- No changes to CLOR logo assets, actual product descriptions, links, pricing API, demo submission handler, user session paths, policy text or customer applications.

## Files
- src/components/HeroShowcase.jsx — photo montage and CSS clip pause control
- src/styles/visual-v2.css — compact layout, grids, photo-card styling, responsiveness
- src/pages/Home.jsx — photo hero, revised h1 styling, tightened connected-story order
- src/App.jsx — stylesheet import
- motion/src/PhotoHero.jsx — photo-led 7-second Remotion source composition
- motion/remotion.config.mjs — share the marketing site's existing /public assets
- motion/src/Root.jsx — register ClorPhotoHero
- motion/package.json — optional render:photo command

## Review and release
1. Run the normal website build and inspect all existing prerendered routes.
2. Compare the live homepage and product-page imagery with these layouts at 1440px, 1024px, 768px, 390px and 360px.
3. Check touch menus, keyboard navigation, pause control, reduced-motion, demo form and operator-backed pricing.
4. Confirm hero overlay cards do not cover subjects in actual photographs.
5. Check Core Web Vitals and avoid loading any rendered MP4 during the initial hero paint.
6. Render motion separately from website/motion using npm install then npm run render:photo; compress, test playback, and add a poster before deciding to ship video.
7. Merge or deploy only after the above checks.

The standalone HTML preview is a visual proof-of-concept with remote image URLs; if the preview viewer blocks external network requests, it displays fallback UI cards. The real React website loads those pictures locally from website/public/people.
