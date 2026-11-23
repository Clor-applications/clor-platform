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
- Design: light only. Pale blue ground (#F2F9FF), navy text (#002B54), blue hairlines (#C4DCF7), pill buttons, 12px controls, 21px panels; one face, Switzer (file in `src/fonts`, Fontshare free licence). Blaze Orange (#FF5400) is kept for primary actions, the current-page marker and the focus ring. The look lives in `src/styles/darwin.css`, loaded after `site.css` and `bands.css`; the older tokens sit at the top of `src/styles/site.css`.
- Home leads with Books, then Payroll, People and Attendance, each beside its screen drawn in code with sample data (`src/components/Windows.jsx`). No animation; pictures wait for the new illustration style.
- Before publishing: `CONTENT_CHECKLIST.md`.
- Home hero picture `public/people/hero-3d-*.webp`: a 3D character from Unsplash (photo QW3OUweGvlA), listed as free under the Unsplash License; licence page and author still to be confirmed.
