/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * One answer to "where do I turn a capability on?"
 *
 * There were four surfaces over one store: Settings → Preferences, six
 * Business panes filtered by subject, and the onboarding picker. Nothing was
 * ever out of step — they all wrote `setFeatures` — but nobody could say in
 * one sentence where to go.
 *
 * What this holds is the consolidation, because it is the kind that creeps
 * back: someone adds a "Sales settings" page with four switches on it and the
 * product has two answers again.
 */

const APP = readFileSync('apps/accounting/src/App.jsx', 'utf8');
const REGISTRY = readFileSync('apps/accounting/src/features/settings/settingsRegistry.js', 'utf8');

const RETIRED = [
  'settingsFeatures',
  'settingsSales',
  'settingsPurchases',
  'settingsInventory',
  'settingsAccounting',
  'settingsPaymentsReceipts',
  'settingsDocuments',
];

describe('Features is a module, not a settings page', () => {
  it('sits in the sidebar beside Settings rather than inside it', () => {
    expect(APP).toMatch(/key: 'features',\s*\n\s*label: 'Features'/);
    /* Its own icon: the gear belongs to Settings, and two gears in one rail
       is the ambiguity this whole change removes. */
    expect(APP).toMatch(/key: 'features'[\s\S]{0,200}icon: SlidersHorizontal/);
  });

  it('keeps the permission the capability screens always had', () => {
    const entry = APP.slice(APP.indexOf("key: 'features'"), APP.indexOf("key: 'features'") + 320);
    expect(entry).toContain("perm: 'SETTINGS::Company Profile::VIEW'");
  });

  it('is reachable from a link', () => {
    expect(APP).toMatch(/^\s*'features',$/m);
  });
});

describe('the duplicate surfaces are gone', () => {
  it('lists none of them in the Settings map', () => {
    for (const key of RETIRED) {
      expect(REGISTRY.includes(`key: '${key}'`)).toBe(false);
    }
  });

  it('still answers their routes, so old links land somewhere', () => {
    for (const key of RETIRED) {
      expect(APP).toContain(`case '${key}':`);
    }
  });

  it('renders the one page for all of them rather than a copy each', () => {
    const block = APP.slice(APP.indexOf("case 'features':"), APP.indexOf("case 'settingsEmail'"));
    /* Every retired route falls through to the same return. Two returns here
       would be two screens again, however similar they looked. */
    const returns = block.match(/return <FeaturesPage/g) || [];
    expect(returns.length).toBe(2); // the canonical route, and the fall-through
    for (const key of RETIRED) expect(block).toContain(`case '${key}':`);
  });

  it('leaves no second component rendering feature switches', () => {
    /* FeatureSettings was the old screen. If it comes back as a route, the
       product has two answers again. */
    expect(APP).not.toContain('<FeatureSettings');
  });
});

describe('what was deliberately left alone', () => {
  it('keeps the onboarding picker, which asks a different question', () => {
    /* "Do you hold stock", once, at signup — not the same job as tuning forty
       switches on a working system. It writes the same store. */
    expect(APP).toContain('<ModulePicker');
  });

  it('keeps one writer for feature state', () => {
    /* The model behind both the page and the panel; the two frames hold no
       switch of their own, so this is the only place a write could come from. */
    const model = readFileSync('apps/accounting/src/features/features/useFeatureCatalog.js', 'utf8');
    const picker = readFileSync('apps/accounting/src/features/settings/ModulePicker.jsx', 'utf8');
    for (const src of [model, picker]) expect(src).toContain('setFeatures');
    for (const frame of ['FeaturesPage.jsx', 'FeaturesPanel.jsx', 'FeatureCatalog.jsx']) {
      expect(readFileSync(`apps/accounting/src/features/features/${frame}`, 'utf8')).not.toContain('setFeatures(');
    }
    /* And no second store anywhere. */
    expect(model).not.toMatch(/featuresV2|businessOperationFlags|sidebarFeatureFlags/);
  });

  it('reads the tax three rather than writing them', () => {
    const page = readFileSync('apps/accounting/src/features/features/useFeatureCatalog.js', 'utf8');
    expect(page).toContain('TAX_FEATURES');
    expect(page).toContain('readOnly: true');
    /*
     * Their store is `taxCompliances`, and `gstEnabled` is read by document
     * logic. A second writer here would be a second truth — so what is banned
     * is writing, not the local read the rows are built from.
     */
    expect(page).not.toMatch(/setTaxCompliances|taxCompliances:\s|setGstEnabled|setTdsEnabled|setTcsEnabled/);
  });
});

describe('dependencies', () => {
  it('does NOT yet make batch expiry depend on batches, and says why', () => {
    /*
     * Right in principle, held back on evidence: one live organisation has
     * batchExpiry on with batchSerial off. `dependsOn` is client-only, so
     * declaring it would not rewrite that row — it would show No while the
     * store said Yes, and the next save would write Yes back.
     *
     * This asserts the reason is still recorded at the site. Someone will
     * add the line back; they should read why it was removed first.
     */
    const catalog = readFileSync('server/src/constants/featureCatalog.ts', 'utf8');
    const block = catalog.slice(catalog.indexOf("key: 'batchExpiry'"), catalog.indexOf("key: 'batchExpiry'") + 900);
    expect(block).not.toContain("dependsOn: 'batchSerial'");
    expect(block).toContain('cmthj0b3v000avnsd50hkmtt5');
  });

  it('turns children off with their parent rather than leaving them stranded', () => {
    const page = readFileSync('apps/accounting/src/features/features/useFeatureCatalog.js', 'utf8');
    expect(page).toMatch(/if \(!next\) for \(const f of catalog\) if \(f\.dependsOn === key\)/);
  });

  it('says what a parent takes with it before the save, not after', () => {
    const page = readFileSync('apps/accounting/src/features/features/FeatureCatalog.jsx', 'utf8');
    expect(page).toContain('Turning this off also turns off');
    /* And promises nothing is destroyed, because nothing is. */
    expect(page).toContain('Nothing is deleted');
  });
});
