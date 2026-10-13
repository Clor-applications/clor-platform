/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Sidebar Features = destination. Contextual Features = temporary tool.
 *
 * The rail goes to the full page from anywhere, like every other rail entry.
 * The panel is reached only from a contextual trigger (⌘K) while working in
 * a module — <main> is keyed on `active`, so navigating out of a half-typed
 * invoice would remount it empty. What this holds is that the rail never
 * opens the panel, that the contextual decision is one explicit function
 * reading the current route, and that the panel state is never derived from
 * the route.
 */

const APP = readFileSync('apps/accounting/src/App.jsx', 'utf8');
const PANEL = readFileSync('apps/accounting/src/features/features/FeaturesPanel.jsx', 'utf8');
const CSS = readFileSync('packages/ui/src/index.css', 'utf8');

describe('the rail', () => {
  it('treats Features as a destination from anywhere, like every other entry', () => {
    /* A click on the rail is "take me there". From Home, from an invoice
       half-typed, from a report — the full page, never the panel. */
    expect(APP).toContain("onClick={() => goTo(entry.key)}");
    expect(APP).not.toContain('handleFeaturesNavigation(e.currentTarget)');
    expect(APP).not.toMatch(/isFeatures \? handleFeaturesNavigation/);
    expect(APP).not.toContain('openFeatures(e.currentTarget)');
  });

  it('lights the route it is on, never an overlay merely open over it', () => {
    expect(APP).toContain('data-active={isRoute}');
    expect(APP).toContain('data-active={isGroupActive || undefined}');
    expect(APP).not.toMatch(/data-active=\{[^}]*featuresOpen/);
    /* The rail never opens the panel, so it has nothing to announce as expanded. */
    expect(APP).not.toContain('aria-expanded={isFeatures');
  });

  it('puts the panel away on the way to anywhere, including where it already is', () => {
    expect(APP).toMatch(/const goTo = useCallback\(\(key\) => \{\s*setFeaturesOpen\(false\);[\s\S]*?setMobileNavOpen\(false\);\s*setActive\(key\);\s*\}, \[\]\);/);
    expect(APP).toContain('onClick={() => goTo(item.key)}');
  });

  it('puts the panel away when a group is opened, not only when a screen is chosen', () => {
    /* Purchases, Sales, Inventory and Master Data are groups: their rail
       entry unfolds children rather than navigating. Leaving the panel over
       the page while the group unfolded beside it would take two clicks to
       reach anything. */
    const group = APP.slice(APP.indexOf('// Collapsed rail: a group tap re-opens') - 600, APP.indexOf('// Collapsed rail: a group tap re-opens'));
    expect(group).toContain('setFeaturesOpen(false);');
  });

  it('stays operable while the panel is open', () => {
    const aside = APP.slice(APP.indexOf('<aside'), APP.indexOf('<nav', APP.indexOf('<aside')));
    expect(aside).not.toMatch(/\binert=/);
  });
});

describe('the contextual trigger (⌘K)', () => {
  it('asks one decision function, from the current route, never the destination', () => {
    expect(APP).toContain("import { featuresPresentationFor } from './features/features/featuresPresentation';");
    expect(APP).toMatch(/if \(featuresPresentationFor\(active\) === 'page'\) \{\s*goTo\('features'\);\s*return;\s*\}\s*openFeatures\(trigger\);/);
  });

  it('puts an open panel away when asked again, without navigating', () => {
    expect(APP).toMatch(/const handleFeaturesNavigation = useCallback\(\s*\(trigger = null\) => \{\s*if \(featuresOpen\) \{\s*setFeaturesOpen\(false\);\s*return;\s*\}/);
  });

  it('is the only caller of that decision', () => {
    const from = APP.indexOf('<CommandPalette');
    const site = APP.slice(from, APP.indexOf('<main', from));
    expect(site).toMatch(/if \(item\.key === 'features'\) \{\s*handleFeaturesNavigation\(\);\s*return;/);
    expect((APP.match(/handleFeaturesNavigation\(/g) || []).length).toBe(1); /* the palette, and nothing else */
  });
});

describe('the screen underneath', () => {
  it('keeps its key, so it is not remounted by the panel', () => {
    expect(APP).toMatch(/<main\s+id="main-content"\s+key=\{active\}\s+inert=\{featuresOpen \|\| undefined\}/);
  });

  it('is the only region the panel makes inert', () => {
    /* The scrim is measured from <main> and stops at the content edge, so
       anything it does not cover must stay clickable — a header you can read
       and click with nothing happening is worse than one that is washed. */
    expect((APP.match(/inert=\{featuresOpen \|\| undefined\}/g) || []).length).toBe(1);
  });

  it('closes the panel on any real navigation', () => {
    expect(APP).toMatch(/useEffect\(\(\) => \{\s*setFeaturesOpen\(false\);\s*\}, \[active\]\);/);
  });
});

describe('the Features route', () => {
  it('renders the full page — for the rail, a saved link and a refresh alike', () => {
    expect(APP).toContain("case 'features':\n        return <FeaturesPage");
  });

  it('wears page chrome, not panel chrome', () => {
    /* A close button on a full page would be a control with nowhere to go.
       Panel chrome belongs to FeaturesPanel; the catalogue belongs to both. */
    const page = readFileSync('apps/accounting/src/features/features/FeaturesPage.jsx', 'utf8');
    expect(page).toContain('<PageHeader');
    expect(page).not.toContain('Close Features');
    expect(page).not.toContain('ui-feature-scrim');
    expect(page).not.toMatch(/role="dialog"/);
    for (const shared of ['FeatureCatalog', 'FeatureFilters', 'FeatureSaveActions']) {
      expect(page).toContain(shared);
      expect(PANEL).toContain(shared);
    }
  });
});

describe('the category filters on a narrow screen', () => {
  /* Ten chips wrapped onto five lines and the header stood 323px tall on an
     812px phone. These assert the mechanism, not a pixel count: wrapping
     where it fits, one scrolling row where it does not. */
  const rule = (selector, from) => {
    const at = CSS.indexOf(selector, from || 0);
    expect(at).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('}', at));
  };

  it('wraps by default, so nothing changes where there is room', () => {
    const base = rule('.ui-filter-scroll {');
    expect(base).toContain('flex-wrap: wrap');
    expect(base).not.toContain('overflow-x');
  });

  it('becomes one scrolling row under 640px', () => {
    const mq = CSS.indexOf('@media (max-width: 640px) {', CSS.indexOf('.ui-filter-scroll {'));
    expect(mq).toBeGreaterThan(-1);
    const narrow = rule('.ui-filter-scroll {', mq);
    expect(narrow).toContain('flex-wrap: nowrap');
    expect(narrow).toContain('overflow-x: auto');
    /* Its own line, and allowed to be narrower than its contents. */
    expect(narrow).toContain('min-width: 0');
  });

  it('keeps every chip at its natural width rather than squeezing labels', () => {
    const kids = rule('.ui-filter-scroll > * {');
    expect(kids).toContain('flex: 0 0 auto');
  });

  it('scrolls without JavaScript', () => {
    const src = readFileSync('apps/accounting/src/features/features/FeatureCatalog.jsx', 'utf8');
    expect(src).toContain('ui-filter-scroll');
    expect(src).not.toMatch(/scrollLeft|scrollIntoView|scrollBy/);
  });
});

describe('the panel', () => {
  it('does not claim modality it does not have, and does not trap Tab', () => {
    /* The rail beside it is operable, so telling a screen-reader user the
       rest of the page is not there would be a lie — and so would a Tab that
       wrapped inside the panel while a mouse could leave it. */
    expect(PANEL).toContain('aria-modal="false"');
    expect(PANEL).not.toMatch(/e\.key\s*[!=]==?\s*'Tab'/);
    expect(PANEL).not.toContain('FOCUSABLE');
  });

  it('bounds its scrim to the content area rather than the viewport', () => {
    const rule = CSS.slice(CSS.indexOf('.ui-feature-scrim {'), CSS.indexOf('}', CSS.indexOf('.ui-feature-scrim {')));
    expect(rule).not.toMatch(/inset:\s*0/);
    /* Placed from the measured rect, every edge, so nothing spills onto the
       rail or the header. */
    expect(PANEL).toMatch(/top: box\.top, left: box\.left, width: box\.width, height: box\.height/);
  });

  it('is a drawer on the layer scale, not a number of its own', () => {
    expect(PANEL).toContain("zIndex: 'var(--z-drawer)'");
    expect(PANEL).toContain("zIndex: 'var(--z-drawer-panel)'");
    expect(PANEL).not.toMatch(/z-\[|zIndex: \d/);
    expect(PANEL).toContain('<OverlayLayerContext.Provider value="drawer">');
  });

  it('measures the content area rather than assuming the rail width', () => {
    expect(PANEL).toContain("document.getElementById('main-content')");
    expect(PANEL).toContain('new ResizeObserver(update)');
  });

  it('washes the content without blurring it', () => {
    const rule = CSS.slice(CSS.indexOf('.ui-feature-scrim {'), CSS.indexOf('.ui-feature-panel {'));
    expect(rule).not.toContain('backdrop-filter');
    expect(rule).toContain('rgb(24 24 27 / 0.24)');
    expect(rule).toContain(":root[data-theme='dark'] .ui-feature-scrim");
  });

  it('settles into place rather than sliding in from off screen', () => {
    expect(CSS).toMatch(/@keyframes ui-panel-in \{\s*from \{ transform: translate3d\(-12px, 0, 0\); opacity: 0; \}/);
    expect(CSS).toMatch(/\.ui-feature-panel \{[^}]*animation: ui-panel-in 180ms/);
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ui-feature-panel \{ animation-name: ui-fade/);
  });
});
