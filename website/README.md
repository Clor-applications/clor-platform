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
- Design: light only, white ground, tokens at the top of `src/styles/site.css`; one face, Plus Jakarta Sans; Blaze Orange (#FF5400) is kept for primary actions, the current-page marker and the focus ring, and #BA3900 for orange words.
- Five products in the owner's order: Books, People, Attendance, Payroll, Workspace (Projects and Timesheet marked coming soon). Home leads with Books' invoice drawn in code with sample data (`src/components/Windows.jsx`), then one section per product beside its drawn screen.
- Pictures: every product screen is drawn in HTML and CSS with sample data (`src/components/Windows.jsx`), captioned as drawn. No stock art, no AI art. Real screenshots of a demo company replace them when captured.
- Header: Products, Pricing, Sign in (company and employee doors), Request a demo. Solutions, guides, company and policy pages are linked from the footer.
- Before publishing: `CONTENT_CHECKLIST.md`.
