import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';

import { EntityMark } from '@ui/components/ui/Primitives';
import { settingFor, visibleCategories } from './settingsRegistry';
import { SETTINGS_ACTIONS_SLOT_ID, SettingsFrameContext } from './settingsFrame';

export const SettingsCatalogNav = ({ activeKey = '', can = () => true, isEnabled = () => true, onSelect }) => {
  const categories = useMemo(() => visibleCategories({ can, isEnabled }), [can, isEnabled]);

  return (
    <aside className="settings-catalog ui-rail hidden w-[15rem] flex-none overflow-y-auto sm:block" aria-label="Settings navigation">
      <nav>
        {categories.map((category) => (
          <section key={category.id} className="settings-catalog-group" aria-labelledby={`settings-heading-${category.id}`}>
            <h2 id={`settings-heading-${category.id}`} className="settings-catalog-heading">{category.title}</h2>
            <div className="settings-catalog-items">
              {category.items.map((item) => {
                const Icon = item.icon;
                const selected = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    data-active={selected ? 'true' : undefined}
                    onClick={() => onSelect(item.key)}
                    className="settings-catalog-link ui-nav-item"
                    data-tone="settings"
                  >
                    <Icon size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 truncate text-left">{item.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
};

export default function SettingsWorkspace({ activeKey, can, isEnabled, onNavigate, onExit, children }) {
  const item = settingFor(activeKey);

  return (
    /* Framed: screens using `SettingsScreenHeader` leave the title to this
       frame and hoist their actions into the slot beside it. */
    <SettingsFrameContext.Provider value>
    <div className="space-y-0">
      <div
        className="settings-page-bar sticky top-0 z-50 flex items-center border-b ui-border-c"
        style={{ backgroundColor: 'rgb(var(--app-bg))', boxShadow: '0 8px 16px rgb(0 0 0 / 0.04)' }}
      >
        {['settingsUsers', 'settingsRoles'].includes(activeKey) ? (
          <div className="settings-users-topbar flex min-w-0 flex-1 items-center gap-2">
            {onExit ? (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm settings-users-back" onClick={onExit} aria-label="Back to application">
                <ArrowLeft size={15} aria-hidden="true" /> Back to app
              </button>
            ) : null}
            <div id={activeKey === 'settingsUsers' ? 'settings-users-header-slot' : 'settings-roles-header-slot'} className="settings-users-header-slot min-w-0" />
          </div>
        ) : <div className="flex items-center gap-2">
          {onExit ? (
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onExit} aria-label="Back to application">
              <ArrowLeft size={15} aria-hidden="true" /> Back to app
            </button>
          ) : null}
          <EntityMark entity="settings" /><h1 className="ui-t-page">Settings</h1>
        </div>}
      </div>

      <div className="settings-workspace flex min-h-[calc(100dvh-12rem)] overflow-hidden border ui-border-c bg-[rgb(var(--surface))]">
        <SettingsCatalogNav activeKey={activeKey} can={can} isEnabled={isEnabled} onSelect={onNavigate} />
        <main className="settings-content min-w-0 flex-1 overflow-y-auto p-4 lg:p-5">
          {item && !['settingsBranches', 'settingsWarehouses', 'settingsTax', 'settingsTds', 'settingsUsers', 'settingsRoles'].includes(activeKey) ? (
            <div className="settings-content-heading mb-3 flex flex-wrap items-start justify-between gap-3 border-b ui-border-c pb-3">
              <h2 className="ui-t-page min-w-0">{item.title}</h2>
              {/* The framed screen's own controls (Save, Revert, ...) land here. */}
              <div
                id={SETTINGS_ACTIONS_SLOT_ID}
                className="flex flex-wrap items-center justify-end gap-2 min-w-0 max-w-full"
              />
            </div>
          ) : null}
          <div className="min-w-0">{children}</div>
        </main>
      </div>
    </div>
    </SettingsFrameContext.Provider>
  );
}
