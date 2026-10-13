import { ArrowLeft, BadgePercent, Boxes, Building2, FileText, Settings, Tags } from 'lucide-react';

import { EntityMark } from '@ui/components/ui/Primitives';

const GROUPS = [
  {
    title: 'Items',
    items: [
      { key: 'items', label: 'Item List', icon: Tags, perm: 'MASTERS::Items::VIEW' },
      { key: 'itemCategories', label: 'Item Categories', icon: Tags, perm: 'MASTERS::Items::VIEW' },
      { key: 'uoms', label: 'Units', icon: Boxes, perm: 'MASTERS::Items::VIEW' },
      { key: 'priceLists', label: 'Price Lists', icon: Tags, perm: 'MASTERS::Items::VIEW', feature: 'priceLists' },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { key: 'bankCash', label: 'Chart of Accounts', icon: Building2, perm: 'ACCOUNTING::Chart of Accounts::VIEW' },
      { key: 'gstRates', label: 'GST Rates', icon: BadgePercent, perm: 'MASTERS::GST Rates::VIEW', feature: 'gst' },
      { key: 'tdsRates', label: 'TDS', icon: BadgePercent, perm: 'MASTERS::GST Rates::VIEW', feature: 'tds' },
      { key: 'tcsRates', label: 'TCS Rates', icon: BadgePercent, perm: 'MASTERS::GST Rates::VIEW', feature: 'tcs' },
    ],
  },
  {
    title: 'Documents',
    items: [
      { key: 'invoiceTemplates', label: 'Invoice Templates', icon: FileText, perm: 'SETTINGS::Document Templates::VIEW' },
      { key: 'docNumbering', label: 'Numbering', icon: Settings, perm: 'SETTINGS::Document Numbering::VIEW' },
      { key: 'settingsTerms', label: 'Terms & Conditions', icon: FileText, perm: 'SETTINGS::Document Templates::VIEW' },
    ],
  },
];

export const MASTER_DATA_KEYS = new Set(['mdm', ...GROUPS.flatMap((group) => group.items.map((item) => item.key))]);
const ITEM_MASTER_KEYS = new Set(['items', 'itemCategories', 'uoms', 'priceLists']);

export default function MasterDataWorkspace({ activeKey, can = () => true, isEnabled = () => true, onNavigate, onExit, children }) {
  const itemMasterActive = ITEM_MASTER_KEYS.has(activeKey);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.perm || can(item.perm)) && (!item.feature || isEnabled(item.feature))),
  })).filter((group) => group.items.length);

  return (
    <div className="space-y-0">
      <div className="settings-page-bar sticky top-0 z-50 flex items-center border-b ui-border-c">
        <div className={`flex min-w-0 flex-1 items-center gap-2 ${itemMasterActive ? 'settings-users-topbar' : ''}`}>
          {onExit ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onExit} aria-label="Back to application"><ArrowLeft size={15} aria-hidden="true" /> Back to app</button> : null}
          {itemMasterActive ? (
            <><h1 className="sr-only">Master Data</h1><div id={`master-${activeKey}-header-slot`} className="settings-users-header-slot min-w-0" /></>
          ) : (
            <><EntityMark entity="items" /><h1 className="ui-t-page">Master Data</h1></>
          )}
        </div>
      </div>
      <div className="settings-workspace flex min-h-[calc(100dvh-12rem)] overflow-hidden border ui-border-c bg-[rgb(var(--surface))]">
        <aside className="settings-catalog ui-rail hidden w-[15rem] flex-none overflow-y-auto sm:block" aria-label="Master Data navigation">
          <nav>
            {groups.map((group) => (
              <section key={group.title} className="settings-catalog-group" aria-labelledby={`master-heading-${group.title.replace(/\s+/g, '-').toLowerCase()}`}>
                <h2 id={`master-heading-${group.title.replace(/\s+/g, '-').toLowerCase()}`} className="settings-catalog-heading">{group.title}</h2>
                <div className="settings-catalog-items">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const selected = activeKey === item.key;
                    return (
                      <button key={item.key} type="button" className="settings-catalog-link ui-nav-item" data-tone="masterdata" data-active={selected ? 'true' : undefined} aria-current={selected ? 'page' : undefined} onClick={() => onNavigate(item.key)}>
                        <Icon size={14} aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 truncate text-left">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        </aside>
        <main className="settings-content min-w-0 flex-1 overflow-y-auto p-4 lg:p-5">{children}</main>
      </div>
    </div>
  );
}
