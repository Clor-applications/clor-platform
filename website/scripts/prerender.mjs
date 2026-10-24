/*
 * Render every route to its own HTML file, so each page is complete before
 * any script runs (search engines, link previews, slow phones), then write
 * the sitemap, robots.txt and the 404 page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const { render, ROUTES } = await import(pathToFileURL(path.join(root, 'dist-ssr', 'entry-server.js')).href);
const SITE_URL = 'https://clor.in';

const write = (route, file) => {
  const { html, head } = render(route);
  const page = template.replace('<!--head-->', head).replace('<!--app-->', html);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page);
};

/* `/products/books` is `products/books.html`: Cloudflare Pages serves it at the address without a slash, which is the canonical one. */
for (const r of ROUTES) {
  const file = r.path === '/' ? path.join(dist, 'index.html') : path.join(dist, `${r.path}.html`);
  write(r.path, file);
}
write('/404', path.join(dist, '404.html'));

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ROUTES.map((r) => `  <url><loc>${SITE_URL}${r.path === '/' ? '/' : r.path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`
);
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
fs.rmSync(path.join(root, 'dist-ssr'), { recursive: true, force: true });
console.log(`Prerendered ${ROUTES.length} pages, 404, sitemap.xml, robots.txt`);
