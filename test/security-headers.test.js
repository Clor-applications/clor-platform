/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The web app is served by Cloudflare Pages, which sends no security headers
 * of its own: without public/_headers any site could frame the app, and HSTS
 * only covered the API. The CSP allows the one inline script in index.html by
 * its hash, so an edit to that script must come with a new hash here.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

describe('web app response headers', () => {
  it('forbid framing and pin HTTPS', () => {
    expect(headers).toMatch(/X-Frame-Options: DENY/);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d{8,}/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
  });

  it('allow every inline script in index.html by its hash', () => {
    const inline = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = createHash('sha256').update(body).digest('base64');
      expect(headers, 'index.html inline script changed: update its sha256 in public/_headers').toContain(`'sha256-${hash}'`);
    }
  });

  it('let the API and map tiles through', () => {
    expect(headers).toMatch(/connect-src [^;]*https:\/\/api\.clor\.in/);
    expect(headers).toMatch(/img-src [^;]*https:\/\/tile\.openstreetmap\.org/);
  });

  it('enforce the policy, and still let document previews and the staging API through', () => {
    expect(headers).toMatch(/^\s+Content-Security-Policy: /m);
    expect(headers).not.toMatch(/^\s+Content-Security-Policy-Report-Only:/m);
    expect(headers).toMatch(/frame-src [^;]*blob:/);
    expect(headers).toMatch(/connect-src [^;]*https:\/\/api\.staging\.clor\.in/);
    expect(headers).toMatch(/object-src 'none'/);
    expect(headers).not.toMatch(/script-src [^;]*'unsafe-(inline|eval)'/);
  });

  it('cache hashed build files for a year', () => {
    expect(headers).toMatch(/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});
