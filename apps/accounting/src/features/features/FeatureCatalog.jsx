import React from 'react';
import { ArrowRight, Check, Lock, RotateCcw, Save, Search } from 'lucide-react';

import { Spinner, SkeletonCard } from '@ui/components/ui/Primitives';

/**
 * The one place a capability is switched on or off — the rendering of it.
 *
 * It used to be four places: Settings → Preferences held all forty switches,
 * six Business panes held the same switches filtered by subject, and the
 * onboarding picker offered them again as packs. Four surfaces, one store —
 * so nothing was ever out of step, but nobody could answer "where do I turn
 * Sales Orders on" with one sentence.
 *
 * This is that sentence, and it is shown in two frames: the panel that opens
 * over any screen (FeaturesPanel), and the full page the old links still
 * land on (FeaturesPage). Both compose what is exported here and neither
 * holds a switch of its own, so the product cannot drift back to two answers
 * that look alike and differ.
 *
 * It is a presentation layer. The catalogue on the server decides what exists,
 * what it defaults to and what is locked; the model comes from
 * `useFeatureCatalog`, whose `setFeatures` call remains the only writer.
 * Nothing here holds feature state of its own.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'Enabled' },
  { key: 'off', label: 'Disabled' },
];

/** Yes/No, not a switch: a dropdown says what the current answer IS. */
const YesNo = ({ value, onChange, disabled, label }) => (
  <select
    value={value ? 'yes' : 'no'}
    onChange={(e) => onChange(e.target.value === 'yes')}
    disabled={disabled}
    aria-label={label}
    className="ui-select ui-feature-answer"
  >
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select>
);

const chipStyle = (on) =>
  on
    ? { backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand-ink))', border: '1px solid rgb(var(--brand) / 0.3)' }
    : { border: '1px solid rgb(var(--border-strong))' };

/**
 * Search, the group chips and the state chips. `searchRef` lets the frame
 * that holds the search decide what Escape means while it has text.
 */
export const FeatureFilters = ({ model, searchRef = null }) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="ui-scope-field inline-flex" style={{ flex: '1 1 16rem', maxWidth: '22rem' }}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={searchRef}
        type="search"
        value={model.query}
        onChange={(e) => model.setQuery(e.target.value)}
        placeholder="Search features"
        aria-label="Search features"
        className="ui-input w-full"
      />
    </div>

    <div className="ms-auto flex items-center gap-1.5">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => model.setState(f.key)}
          className="ui-btn ui-btn-sm"
          style={chipStyle(model.state === f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  </div>
);

/** Unsaved / Saved, Revert, Save — the one write, wherever the frame puts it. */
export const FeatureSaveActions = ({ model }) => (
  <>
    {model.dirty ? <span className="ui-pill ui-pill-warn">Unsaved changes</span> : null}
    {!model.dirty && model.savedAt ? (
      <span className="ui-pill ui-pill-pos" role="status">
        <Check size={11} aria-hidden="true" /> Saved
      </span>
    ) : null}
    <button
      type="button"
      className="ui-btn ui-btn-secondary"
      onClick={model.revert}
      disabled={!model.dirty || model.saving}
    >
      <RotateCcw size={16} aria-hidden="true" /> Revert
    </button>
    <button type="button" className="ui-btn ui-btn-primary" onClick={model.save} disabled={!model.dirty || model.saving}>
      {model.saving ? <Spinner /> : <Save size={16} aria-hidden="true" />}
      {model.saving ? 'Saving…' : 'Save changes'}
    </button>
  </>
);

const FeatureRow = ({ row, section, model, onNavigate }) => {
  const Icon = row.icon;
  const parent = row.dependsOn ? model.catalog.find((x) => x.key === row.dependsOn) : null;
  const blocked = Boolean(parent && model.values[parent.key] === false);
  const disabled = row.locked || blocked || row.notEntitled || row.readOnly;
  const losing = !row.readOnly && model.values[row.key] ? model.childrenOf(row.key) : [];

  return (
    <div className="ui-feature-row">
      {Icon ? (
        <span
          aria-hidden="true"
          className="ui-feature-mark"
          style={{
            '--cat-ink': `var(--cat-${section.key})`,
            '--cat-soft': `var(--cat-${section.key}-soft)`,
          }}
        >
          <Icon size={16} />
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{row.label}</span>
          {row.locked ? (
            <span className="ui-pill ui-pill-neutral">
              <Lock size={10} aria-hidden="true" /> Always on
            </span>
          ) : null}
          {row.notEntitled ? (
            <span className="ui-pill ui-pill-neutral">
              <Lock size={10} aria-hidden="true" /> {row.upgradeHint || 'Not on your plan'}
            </span>
          ) : null}
          {blocked ? <span className="ui-pill ui-pill-warn">Needs {parent.label}</span> : null}
        </span>
        {/* Explanatory text only where something is at stake: a dependency, a
            consequence, or a value this surface does not own. A line under
            "Sales Orders" saying it enables sales orders is noise. */}
        {losing.length ? (
          <span className="ui-caption block mt-0.5">
            Turning this off also turns off {losing.map((c) => c.label).join(', ')}. Nothing is deleted.
          </span>
        ) : null}
      </span>

      {row.readOnly ? (
        <span className="text-sm ui-muted flex-none text-center" style={{ width: '6rem' }}>
          {row.enabled ? 'Enabled' : 'Disabled'}
        </span>
      ) : (
        <YesNo
          value={Boolean(model.effective[row.key])}
          onChange={(next) => model.toggle(row.key, next)}
          disabled={disabled}
          label={row.label}
        />
      )}

      {/* Configure appears where a capability has a real screen and is
          switched on. No screen, no link — a row is not made consistent by
          inventing somewhere for it to go. */}
      <span className="flex-none" style={{ width: '6.25rem' }}>
        {row.config && (row.enabled || row.readOnly) && onNavigate ? (
          <button type="button" onClick={() => onNavigate(row.config)} className="ui-feature-config">
            Configure <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  );
};

const FeatureCategory = ({ section, model, onNavigate }) => (
  <section className="ui-card overflow-hidden">
    <div
      className="px-4 py-2 ui-sunken flex items-center justify-between gap-3"
      style={{ borderBottom: '1px solid rgb(var(--border))' }}
    >
      <div className="ui-t-label">{section.label}</div>
      <div className="ui-caption">
        {section.items.length} {section.items.length === 1 ? 'feature' : 'features'}
      </div>
    </div>
    <div className="ui-feature-grid">
      {section.items.map((r) => (
        <FeatureRow key={r.key} row={r} section={section} model={model} onNavigate={onNavigate} />
      ))}
    </div>
  </section>
);

/** The categories and their rows, plus the empty state and the footnote. */
export const FeatureCatalog = ({ model, onNavigate = null }) => {
  if (model.loading) return <SkeletonCard lines={5} />;

  return (
    <div className="space-y-3">
      {model.error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {model.error}
        </div>
      ) : null}

      {!model.sections.length ? (
        <div className="ui-card p-6 text-center text-sm ui-muted">
          {model.query.trim() ? `No feature matches “${model.query.trim()}”.` : 'Nothing here.'}
        </div>
      ) : null}

      {model.sections.map((section) => (
        <FeatureCategory key={section.key} section={section} model={model} onNavigate={onNavigate} />
      ))}

      <p className="ui-subtle text-xs">
        Switching a feature off hides it. Nothing already recorded is deleted, and turning it back on restores access.
      </p>
    </div>
  );
};

export default FeatureCatalog;
