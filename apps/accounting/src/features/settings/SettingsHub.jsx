import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';

import { EntityMark } from '@ui/components/ui/Primitives';
import { categoryFor, searchSettings } from './settingsRegistry';
import { SettingsCatalogNav } from './SettingsWorkspace';

/** Settings uses the same category-and-list workspace as Reports. */
export default function SettingsHub({ can = () => true, isEnabled = () => true, onOpenSetting, onExit }) {
  const [search, setSearch] = useState('');
  const query = search.trim();
  const searchResults = useMemo(
    () => (query ? searchSettings(query, { can, isEnabled }) : []),
    [query, can, isEnabled]
  );
  const settings = query ? searchResults : [];

  return (
    <div className="space-y-0">
      <div
        className="settings-page-bar sticky top-0 z-50 grid grid-cols-1 items-center gap-3 border-b py-2.5 ui-border-c sm:grid-cols-[1fr_minmax(16rem,24rem)_1fr]"
        style={{ backgroundColor: 'rgb(var(--app-bg))', boxShadow: '0 8px 16px rgb(0 0 0 / 0.04)' }}
      >
        <div className="flex items-center gap-2.5">
          {onExit ? (
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onExit} aria-label="Back to application">
              <ArrowLeft size={15} aria-hidden="true" /> Back to app
            </button>
          ) : null}
          <EntityMark entity="settings" /><div><h1 className="ui-t-page">Settings</h1><p className="ui-muted text-xs">Manage company preferences and controls</p></div>
        </div>
        <label className="relative block w-full">
          <Search size={17} className="ui-subtle absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" className="ui-input w-full ps-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all settings…" aria-label="Search all settings" />
        </label>
        <span aria-hidden="true" />
      </div>

      <div className="settings-workspace flex min-h-[calc(100dvh-12rem)] overflow-hidden border ui-border-c bg-[rgb(var(--surface))]">
        <SettingsCatalogNav can={can} isEnabled={isEnabled} onSelect={onOpenSetting} />

        <main className="settings-content min-w-0 flex-1 p-5 lg:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b ui-border-c pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[rgb(var(--heading-bg))]"><Search size={17} aria-hidden="true" /></span>
              <div>
                <h2 className="text-sm font-bold">{query ? 'Search results' : 'Choose a setting'}</h2>
                <p className="ui-muted text-xs">{query ? `${settings.length} setting${settings.length === 1 ? '' : 's'} found` : 'Select an option from the settings list on the left.'}</p>
              </div>
            </div>
          </div>

          <div className="grid overflow-hidden rounded-xl border ui-border-c xl:grid-cols-2">
            {settings.map((item) => {
              const Icon = item.icon;
              const itemCategory = categoryFor(item.category);
              return (
                <button key={item.key} type="button" onClick={() => onOpenSetting(item.key)} className="group flex min-h-[4.25rem] w-full items-center gap-3 border-b ui-border-c px-4 py-3 text-left transition-all hover:bg-[rgb(var(--heading-bg))] focus-visible:z-10 xl:odd:border-e">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-md bg-[rgb(var(--surface-sunken))] transition-colors group-hover:bg-[rgb(var(--surface))]"><Icon size={15} className="ui-muted" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    <span className="ui-muted mt-0.5 block truncate text-xs">{query ? `${itemCategory?.title || 'Settings'} · ${item.description}` : item.description}</span>
                  </span>
                  <ChevronRight size={15} className="ui-subtle shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              );
            })}
            {!settings.length ? <div className="col-span-full px-5 py-12 text-center text-sm ui-muted">{query ? `No settings match “${query}”.` : 'Choose a setting to view and update it here.'}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
