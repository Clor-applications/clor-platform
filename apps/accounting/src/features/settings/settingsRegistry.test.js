import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { appSource } from '../../testing/appSource.js';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_ITEMS,
  breadcrumbFor,
  isSettingsKey,
  settingsBackTarget,
  groupedForCategory,
  searchSettings,
  visibleCategories,
  visibleSettings,
} from './settingsRegistry';

/* src/features/settings/ → src/ */
const SRC = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APP = appSource(join(SRC, 'App.jsx'));

const all = { can: () => true, isEnabled: () => true };

describe('nothing was lost on the way in', () => {
  /*
   * The rail group this replaces held thirty-four settings. A redesign that
   * quietly drops one is worse than the long rail it replaced: the setting is
   * still there, still doing something, and now unreachable.
   */
  it('every setting points at a screen the application already renders', () => {
    const missing = SETTINGS_ITEMS.filter((item) => !APP.includes(`case '${item.key}'`));
    expect(missing.map((m) => m.key)).toEqual([]);
  });

  /*
   * And nothing was lost on the way out either.
   *
   * The test above asks that every setting has a screen. Nobody asked the
   * reverse, and four screens fell through the gap: a working Backup page, a
   * second numbering page, a combined users-and-roles page and a terms page —
   * each rendering real code with no route to it from anywhere in the product.
   * Backup was the one that mattered: a company's own data, and the only way
   * out of it, reachable by nobody.
   */
  it('every settings screen has a route to it from somewhere', () => {
    /* Screens the switch answers to that look like settings. */
    const cases = [...APP.matchAll(/case '([A-Za-z0-9]+)':/g)].map((m) => m[1]);
    const settingsish = [...new Set(cases)].filter((k) => /^settings[A-Z]/.test(k));

    /*
     * Three ways in, and a screen needs one of them: the hub, the navigation
     * rail, or something in the product that navigates there — the profile is
     * reached from the account menu, and a person's own name is not a company
     * setting.
     */
    const inHub = new Set(SETTINGS_ITEMS.map((i) => i.key));

    /*
     * A fourth way in, which is really a way OUT: the seven capability
     * surfaces that Settings used to carry now render the Features page.
     * They are kept as routes so old links and bookmarks still land
     * somewhere, and deliberately have no hub entry — seven doors to one
     * room is the duplication the consolidation removed.
     */
    const REDIRECTS_TO_FEATURES = new Set([
      'settingsFeatures',
      'settingsSales',
      'settingsPurchases',
      'settingsInventory',
      'settingsAccounting',
      'settingsPaymentsReceipts',
      'settingsDocuments',
    ]);

    const reachable = (key) =>
      inHub.has(key) ||
      REDIRECTS_TO_FEATURES.has(key) ||
      APP.includes(`key: '${key}'`) ||
      APP.includes(`setActive('${key}')`);

    /*
     * One screen is knowingly unreachable and stays that way until somebody
     * decides which of two numbering pages is the real one: this one reads and
     * writes number series on the server, and the one in the hub keeps them in
     * the browser's own state. Deleting the wrong one loses work; showing both
     * gives a person two pages that disagree. Named here so it is a decision
     * waiting rather than an oversight repeating.
     */
    const pendingDecision = new Set(['settingsNumbering']);

    expect(settingsish.filter((k) => !reachable(k) && !pendingDecision.has(k))).toEqual([]);
  });

  it('every setting belongs to a category that exists', () => {
    const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
    expect(SETTINGS_ITEMS.filter((i) => !ids.has(i.category)).map((i) => i.key)).toEqual([]);
  });

  it('names each screen once', () => {
    const keys = SETTINGS_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('what a person may open', () => {
  /* The same two tests the rail applies, or a card counts what it cannot open. */
  it('hides a setting whose permission is refused', () => {
    const can = (p) => p !== 'SETTINGS::Users::VIEW';
    const keys = visibleSettings({ can, isEnabled: () => true }).map((i) => i.key);
    expect(keys).not.toContain('settingsUsers');
    expect(keys).toContain('settingsCompany');
  });

  it('keeps warehouses under Organisation, and branches with the company in Workspace', () => {
    const isEnabled = (f) => f !== 'branches';
    const keys = visibleSettings({ can: () => true, isEnabled }).map((i) => i.key);
    /* Branches are the company's, shared by every app (ADR-010); warehouses are Accounting's stock. */
    expect(keys).not.toContain('settingsBranches');
    expect(keys).toContain('settingsWarehouses');
  });

  it('drops a category once nothing in it is left', () => {
    const can = (p) => !['SETTINGS::Tax Settings::VIEW', 'MASTERS::GST Rates::VIEW'].includes(p);
    const ids = visibleCategories({ can, isEnabled: () => true }).map((c) => c.id);
    expect(ids).not.toContain('tax');
    expect(ids).toContain('organisation');
  });

  it('counts only what the card can open', () => {
    const can = (p) => p !== 'MASTERS::Company/Branch setup::VIEW';
    const org = visibleCategories({ can, isEnabled: () => true }).find((c) => c.id === 'organisation');
    expect(org.items.map((i) => i.key)).not.toContain('settingsBranches');
    expect(org.items.map((i) => i.key)).not.toContain('settingsWarehouses');
  });
});

describe('local navigation', () => {
  it('keeps Settings Back inside settings instead of jumping to reports', () => {
    expect(settingsBackTarget('reports')).toBe('settings');
    expect(settingsBackTarget('settingsCompany')).toBe('settings');
    expect(settingsBackTarget('settings')).toBe('settings');
  });

  it('returns to a document screen when settings was opened as an errand', () => {
    expect(settingsBackTarget('invoices')).toBe('invoices');
    expect(settingsBackTarget('bills')).toBe('bills');
  });

  it("keeps Accounting's own control under Security, and the company's in Workspace", () => {
    /* Permissions, sign-in, the audit trail and SSO moved to Workspace (ADR-010); posting approvals are Accounting's. */
    const groups = groupedForCategory('security', all);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('');
    expect(groups[0].items.map((item) => item.key)).toEqual(['settingsGovernance']);
  });

  it('keeps a group together wherever its members are declared', () => {
    /* Grouping by adjacency once rendered "Your account" twice in Finance,
       with a duplicate React key each visit. Finance's account and billing
       entries moved to Workspace (ADR-010), so the rule is checked on
       every category: no group heading appears twice in one. */
    for (const c of SETTINGS_CATEGORIES) {
      const names = groupedForCategory(c.id, all).map((g) => g.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  /* One heading over the whole list says nothing the page title has not said. */
  it('leaves a short category ungrouped', () => {
    const groups = groupedForCategory('tax', all);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('');
    /* TDS joined the Taxation category with its configuration page. Tax Rates
       left the catalogue for Masters, which owns the rate list
       (HIDDEN_FROM_SETTINGS in settingsRegistry.js). */
    expect(groups[0].items.map((i) => i.key)).toEqual(['settingsTax', 'settingsTds']);
  });
});

describe('search finds what people type', () => {
  it('matches a word the title does not contain', () => {
    /* Sign-in lives in Workspace now; Settings finds the way there. */
    expect(searchSettings('password', all).map((i) => i.key)).toContain('companyAdmin');
    /* "tds" used to reach the Payments pane by keyword; that pane was a
       capability surface and has gone to Features. The TDS settings page is
       what someone typing this is actually after. */
    expect(searchSettings('tds', all).map((i) => i.key)).toContain('settingsTds');
    expect(searchSettings('godown', all).map((i) => i.key)).toContain('settingsWarehouses');
  });

  it('puts the setting actually called that first', () => {
    expect(searchSettings('gst', all)[0].key).toBe('settingsTax');
    expect(searchSettings('roles', all)[0].key).toBe('accountingRoles');
  });

  it('finds the backup by the words somebody would reach for', () => {
    /* It was written, wired to a screen, and in no list — so no search could
       have found it either. Data export now lives in Workspace with the rest
       of the company's administration (ADR-010; settingsDataBackup redirects
       there), so the words lead to the one entry that opens Workspace. */
    for (const word of ['backup', 'export', 'download', 'copy']) {
      expect(searchSettings(word, all).map((i) => i.key)).toContain('companyAdmin');
    }
  });

  /* "finds every invoice-related page from one word" is retired: Invoice
     Settings, Invoice Templates and Recurring Invoices left the Settings
     catalogue with the rest of the platform category and are reached from
     Sales and Masters (HIDDEN_FROM_SETTINGS in settingsRegistry.js). */

  it('never offers what the person cannot open', () => {
    const can = (p) => p !== 'SETTINGS::Users::VIEW';
    expect(searchSettings('users', { can, isEnabled: () => true }).map((i) => i.key)).not.toContain('settingsUsers');
  });

  it('returns nothing for nothing', () => {
    expect(searchSettings('   ', all)).toEqual([]);
  });
});

describe('breadcrumbs', () => {
  it('reads Settings / category / setting, with the last one not a link', () => {
    const crumbs = breadcrumbFor('companyAdmin');
    expect(crumbs.map((c) => c.label)).toEqual(['Settings', 'User & Roles', 'Users, roles & security']);
    expect(crumbs[0].target).toBe('settings');
    expect(crumbs[1].target).toBe('category:usersRoles');
    expect(crumbs.at(-1).target).toBeNull();
  });

  it('falls back to Settings alone for a key it does not know', () => {
    expect(breadcrumbFor('nonsense').map((c) => c.label)).toEqual(['Settings']);
  });
});

describe('a whole screen is not framed as a settings panel', () => {
  /*
   * Recurring Invoices arrived in Settings with its own title, toolbar, five
   * summary tiles and a filterable table — and the settings frame added a
   * breadcrumb and a second copy of the title above it, then squeezed the
   * table into the column left over beside the settings nav.
   *
   * The rule that catches the next one: if the screen a setting opens renders
   * DocumentListShell, it is a list, not a setting, and must not be framed.
   */
  const SRC_DIR = SRC;

  /* Every .jsx file under a folder. Read with Node, not ripgrep: the test must
     not depend on a tool the CI machine may not have. */
  const jsxFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : jsxFiles(path);
      return entry.name.endsWith('.jsx') ? [path] : [];
    });

  /** The component App returns for a key, read from its case arm. */
  const componentFor = (key) => {
    const at = APP.indexOf(`case '${key}':`);
    if (at < 0) return null;
    const arm = APP.slice(at, at + 800);
    const m = arm.match(/return\s*\(?\s*<([A-Z][A-Za-z0-9]*)/);
    return m ? m[1] : null;
  };

  /**
   * Whether that component builds a document list.
   *
   * Scoped to the component's own body, not its file: most of these live in
   * App.jsx, which mentions DocumentListShell in dozens of screens that have
   * nothing to do with this one. A file-level grep called every one of them a
   * list.
   */
  const isDocumentList = (name) => {
    if (!name) return false;
    const files = jsxFiles(SRC_DIR).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes(`const ${name} =`) || src.includes(`function ${name}(`);
    });

    return files.some((f) => {
      const src = readFileSync(f, 'utf8');
      const at = Math.max(src.indexOf(`const ${name} = `), src.indexOf(`function ${name}(`));
      if (at < 0) return false;
      /* To the next top-level declaration, which is where this one ends. */
      const rest = src.slice(at + 1);
      const next = rest.search(/\n(?:export )?(?:const|function) [A-Z]/);
      return (next < 0 ? rest : rest.slice(0, next)).includes('DocumentListShell');
    });
  };

  it('no framed setting opens onto a document list', () => {
    const framed = SETTINGS_ITEMS.filter((i) => !i.standalone);
    const wrong = framed.filter((i) => isDocumentList(componentFor(i.key)));
    expect(wrong.map((i) => i.key)).toEqual([]);
  });

  it('opens the standalone ones outside the frame', () => {
    expect(isSettingsKey('recurringInvoices')).toBe(false);
    expect(isSettingsKey('paymentReminders')).toBe(false);
    /* A real settings panel still gets the frame. */
    expect(isSettingsKey('settingsTax')).toBe(true);
  });

  it('keeps them out of the Settings catalogue, as the rail now owns them', () => {
    /* They used to be listed and searched here. The platform category left
       the catalogue (HIDDEN_FROM_SETTINGS in settingsRegistry.js): Recurring
       Invoices is in the Sales rail, the templates in Masters. A key stays
       routable so old links still land. */
    expect(searchSettings('recurring', all).map((i) => i.key)).not.toContain('recurringInvoices');
    expect(visibleCategories(all).some((c) => c.id === 'business')).toBe(false);
    expect(visibleCategories(all).some((c) => c.id === 'platform')).toBe(false);
    expect(APP).toContain("case 'recurringInvoices':");
    expect(APP).toContain("key: 'recurringInvoices'");
  });
});
