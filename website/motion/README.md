# CLOR Motion Studio (optional video source)

Two original Remotion compositions are provided as editable source: `ConnectedSuite` (9 seconds) and `ClorHero` (7 seconds), 1920×1080, 30 fps. They are **not** bundled into the marketing site or rendered yet. This keeps the public Vite build fast and avoids introducing Remotion's renderer into production.

From `website/motion/`: `npm install`, `npm run studio`, then `npm run render:connected` or `npm run render:hero`. Output is written under `out/` and can be transcoded/compressed to MP4 and WebM before using it on the site.

## Publishing rules

- Keep the real DOM headline, product copy, CTA buttons and working navigation; video is decorative only and must never carry essential information.
- Use a still poster with `preload="none"`, `muted`, `playsInline`, `loop`, and respect `prefers-reduced-motion` plus user data-saver settings. Do not autoplay on constrained mobile connections.
- Export a still poster at 1600px wide and a lightweight mobile alternative. Budget the video **after** verifying page speed; avoid downloading it during first paint.
- The glyphs and sequence are illustrative and should not imply specific product integrations that are not configured.
