# clor.in

The public website. Static: every page is prerendered to HTML at build time and served by Cloudflare Pages.
It is separate from the app (`app.clor.in`) and changes nothing in it; the legal pages reuse the app's own
documents (`packages/shell/legal`), so both always show the same text.

```bash
npm install
npm run dev       # http://localhost:5190
npm run build     # dist/: one HTML file per page, sitemap.xml, robots.txt, 404.html
npm run preview   # http://localhost:5191, the built site
```

- Content and product status: `src/site.js`, `src/content.js`. Pages: `src/pages`. Routes and page titles: `src/routes.jsx`.
- Design: light only, tokens at the top of `src/styles/site.css`; Manrope for headings, Inter for text; the
  orange is kept for primary actions, the current-page marker and the Clor dot.
- The one animation is the "Clor Connection" on the home page (`src/components/Connection.jsx`); with reduced
  motion, or before the script runs, the finished picture is shown.
- Before publishing: `CONTENT_CHECKLIST.md`.
