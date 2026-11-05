import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The People design audit of 4 Nov 2026 (docs/people/design-v1/DESIGN-AUDIT-2026-11-04.md), blockers 1–9 and the
 * owner's answers Q2, Q3, Q10 and Q11, read off the stylesheet. DESIGN.md is the rule: 120ms for a state and 200ms
 * for a surface, 8px on what you press and 12px on what holds content, a lift only on hover, Bricolage for page
 * titles and figures and nothing else.
 */
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const index = readFileSync('packages/ui/src/index.css', 'utf8');
const design = readFileSync('DESIGN.md', 'utf8');
const claude = readFileSync('CLAUDE.md', 'utf8');

/* Every rule as { sel, body }, comments removed, @media wrappers flattened. */
const rules = (css) => {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) out.push({ sel: m[1].replace(/@media[^{]*$/, '').trim(), body: m[2] });
  return out;
};
const all = rules(people);
const ms = (decl) => [...decl.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(([, n, u]) => (u === 's' ? Number(n) * 1000 : Number(n)));

describe('1. Home arrives at once: 200ms, opacity and a small rise, no blur', () => {
  it('the reveal animates opacity and transform only, over 200ms, staggered by at most 120ms', () => {
    const reveal = all.filter((r) => /\[data-reveal\]/.test(r.sel));
    expect(reveal.length).toBeGreaterThan(0);
    for (const r of reveal) expect(r.body).not.toMatch(/filter|blur/);
    const base = reveal.find((r) => /^\.people-soft \[data-reveal\]$/.test(r.sel));
    expect(base.body).toMatch(/transform: translateY\(0\.5rem\)/);
    expect(base.body).toMatch(/transition: opacity 200ms var\(--soft-ease\), transform 200ms var\(--soft-ease\)/);
    expect(base.body).toMatch(/transition-delay: calc\(min\(var\(--i, 0\), 4\) \* 30ms\)/);
  });

  it('no Home motion runs longer than a surface (200ms), and the chart draws in 400ms with no wait', () => {
    for (const r of all.filter((x) => /\.soft-|people-soft/.test(x.sel))) {
      for (const decl of r.body.split(';').filter((d) => /^\s*(transition|animation)(-duration|-delay)?\s*:/.test(d))) {
        if (/soft-chart-line/.test(r.sel)) continue;
        for (const t of ms(decl)) expect(t, `${r.sel} { ${decl.trim()} }`).toBeLessThanOrEqual(200);
      }
    }
    const chart = all.filter((r) => /^\.soft-chart-line$/.test(r.sel)).map((r) => r.body).join(';');
    expect(chart).toMatch(/animation: soft-draw 400ms var\(--soft-ease\) forwards/);
  });

  it('no blur filter is left anywhere in People', () => {
    expect(people).not.toMatch(/filter:\s*blur\(/);
  });
});

describe('2. Radii: 8px on what you press, 12px on what holds content', () => {
  it('People sets the platform radius tokens on its own palette', () => {
    expect(people).toMatch(/:root\[data-palette='sky'\],\n\[data-palette='sky'\] \{\n\s*--radius-btn: 0\.5rem;\n\s*--radius-input: 0\.5rem;\n\s*--radius: 0\.75rem;\n\s*--radius-lg: 0\.5rem;\n\s*--radius-xl: 0\.75rem;\n\s*--radius-kpi: 0\.75rem;/);
  });

  it('Coming up and its date tiles take the button radius, cards and icon tiles leave 10, 14 and 16px', () => {
    const body = (sel) => all.filter((r) => r.sel === sel).map((r) => r.body).join(';');
    expect(body('.soft-event')).toMatch(/border-radius: var\(--radius-btn\)/);
    expect(body('.soft-event-date')).toMatch(/border-radius: var\(--radius-btn\)/);
    for (const r of all.filter((x) => /soft-|org-card|ui-card/.test(x.sel))) {
      expect(r.body, r.sel).not.toMatch(/border-radius:\s*(1rem|0\.875rem|0\.625rem)/);
    }
  });
});

describe('3. One Approve: an 8px button at 28px, 44px on a phone', () => {
  it('the Home chip is a compact button, not a pill', () => {
    const chip = all.filter((r) => r.sel === '.soft-chip').map((r) => r.body).join(';');
    expect(chip).toMatch(/border-radius: var\(--radius-btn\)/);
    expect(chip).toMatch(/height: 1\.75rem/);
    expect(chip).not.toMatch(/999px/);
  });

  it('the quick links are 36px, and the compact button is 28px, not 30', () => {
    expect(people).toMatch(/\.people-soft \.soft-pill \{[^}]*height: 2\.25rem/);
    expect(people).toMatch(/#main-content \.ui-btn-sm:not\(\.ui-icon-btn\) \{ height: 1\.75rem; min-height: 1\.75rem;/);
    expect(people).not.toMatch(/\.ui-btn-sm[^{]*\{[^}]*height: 1\.875rem/);
  });
});

describe('Buttons and Home hovers animate transform and opacity only, 120–200ms (review of #128)', () => {
  it('the People button, the quick links and a clickable Home block', () => {
    const tx = (sel) => all.filter((r) => r.sel === sel).map((r) => (r.body.match(/transition:([^;]*)/) || [])[1]).filter(Boolean);
    for (const sel of [":root[data-palette='sky'] #main-content .ui-btn:not(.ui-icon-btn)", '.soft-pill', '.soft-core-action']) {
      const t = tx(sel);
      expect(t.length, sel).toBeGreaterThan(0);
      for (const v of t) {
        for (const part of v.split(',')) expect(part.trim(), sel).toMatch(/^(transform|opacity) (1[2-9]\d|200)ms /);
      }
    }
  });
});

describe('4. The primary button has no glow at rest', () => {
  it('flat red fill, no shadow; hover changes the fill only', () => {
    expect(people).toMatch(/html:root\[data-palette='sky'\] :is\(#main-content, \.ui-scrim\) :is\(\.ui-btn-primary, \.ui-btn-brand\),\nhtml:root\[data-palette='sky'\] \.soft-pill-primary \{ background-image: none; box-shadow: none; \}/);
    expect(people).toMatch(/:is\(\.ui-btn-primary, \.ui-btn-brand\):hover:not\(:disabled\) \{ background-color: rgb\(var\(--brand-ink\)\); box-shadow: none; \}/);
  });
});

describe('5. One shadow family, in warm ink', () => {
  it('redefines the three platform shadows on the sky palette, with no navy', () => {
    expect(people).toMatch(/--shadow-card: 0 1px 2px rgb\(31 26 28 \/ 0\.04\);/);
    expect(people).toMatch(/--shadow-pop: 0 12px 32px -12px rgb\(31 26 28 \/ 0\.18\);/);
    expect(people).toMatch(/--shadow-lift: 0 10px 24px -10px rgb\(31 26 28 \/ 0\.16\);/);
    expect(people).not.toMatch(/11 31 68/);
  });

  it('Home\'s soft shadows point at those tokens; no hand-written oxblood shadow is left', () => {
    expect(people).toMatch(/--lift: var\(--shadow-card\);\s*--lift-hi: var\(--shadow-lift\);/);
    expect(people).not.toMatch(/0 \d+px \d+px[^;]*rgb\(92 10 22 \/ 0\.\d+\)/);
  });
});

describe('8. Section heads are Inter 16/24 at 600; Bricolage for titles and figures only (Q11)', () => {
  it('section and panel heads, rail labels, panel names and the app name are in the working face', () => {
    expect(people).toMatch(/html:root\[data-palette='sky'\] :is\(#main-content, \.ui-scrim, \.ui-split-panel\) :is\(h2, \.ui-t-sec, \.soft-panel-title\) \{ font-family: inherit; font-size: 1rem !important; line-height: 1\.5rem !important; font-weight: 600 !important; letter-spacing: 0; color: rgb\(var\(--fg\)\); \}/);
    expect(people).toMatch(/html:root\[data-palette='sky'\] :is\(\.ui-split-mod, \.ui-split-mod > span, \.ui-split-panel p\.ui-caption, \.ui-app-switch-name, \.ui-topbar-initials, \.ui-avatar-initials, \.people-face, \.ui-side-title, \.soft-news-title, \.soft-event-title, \.soft-event-date b, \.people-row-count\) \{ font-family: inherit; \}/);
    /* Nothing between 16 and 24: the module panel's name was 18px. */
    expect(people).not.toMatch(/\.ui-split-panel-head \.ui-t-sec \{[^}]*font-size: 1\.125rem/);
  });

  it('only page titles and figures name the display face', () => {
    const display = all.filter((r) => /font-family:\s*var\(--font-display/.test(r.body)).map((r) => r.sel);
    const allowed = /^(h1|\.ui-t-page|\.soft-band-stat-value|\.soft-snap-value|\.soft-chart-tip|\.ui-metric-value|\.ui-metric strong|\.org-card-n|h1\.ui-t-page)$/;
    for (const sel of display) {
      const parts = sel.replace(/^.*?:is\(/, '').replace(/\)\s*$/, '').split(',').map((s) => s.trim().replace(/^.*(#main-content|\]|\.ui-metric-strip) /, '').trim());
      for (const p of parts) expect(p, sel).toMatch(allowed);
    }
  });

  it('the dead Plus Jakarta Sans line is gone', () => {
    expect(people).not.toMatch(/--font-display: 'Plus Jakarta Sans/);
  });
});

describe('Q2 and Q3: no double bezel and no arrow orb', () => {
  it('the switched-off bezel and its pad are deleted, not just set to nought', () => {
    expect(people).not.toMatch(/soft-bezel|--soft-pad/);
    expect(index).not.toMatch(/--soft-pad/);
    expect(people).not.toMatch(/soft-pill-orb/);
  });
});

describe('Q10: two faces, written down the same way everywhere', () => {
  it('CLAUDE.md no longer says one face, and DESIGN.md\'s scale says People titles 28/800', () => {
    expect(claude).not.toMatch(/One face app-wide/);
    expect(claude).toMatch(/Two faces/);
    expect(design).toMatch(/\| Page title \(People\) \| Bricolage Grotesque \| 28 \/ 34 \| 800 \|/);
    expect(design).toMatch(/\| 2026-11-04 \| People design audit: the owner's twelve answers \|/);
  });
});
