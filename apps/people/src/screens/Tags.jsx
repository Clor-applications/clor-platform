import { errorWords } from '@ui/utils/errorWords';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { SkeletonCard, Button } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createTag, deleteTag, listTags } from '@ui/personnel/api';

/* The categorical series, stored as hex because a tag keeps its colour; drawn from the token (rnd.css --cat-1..8)
   so the screen never paints a raw hex. A colour from before the series is drawn as it was stored. */
const SWATCHES = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];
const SWATCH_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red'];
const dotColour = (hex) => {
  const i = SWATCHES.indexOf(String(hex || '').toUpperCase());
  return i >= 0 ? `rgb(var(--cat-${i + 1}))` : hex || 'rgb(var(--border-strong))';
};

/**
 * Labels for grouping people — Remote, Night shift, Key person (PEOPLE-39): the list on the page ground under one
 * hairline, each tag a soft pill with its colour as a dot and its name in ink; Add tag is the one primary action.
 */
export default function Tags() {
  const [tags, setTags] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => listTags().then((t) => { setTags(t); setLoadError(null); }).catch((e) => setLoadError(e)), []);
  useEffect(() => {
    load();
  }, [load]);

  const open = () => {
    setName('');
    /* The next colour not yet used, so two tags side by side are told apart. */
    const used = new Set((tags || []).map((t) => String(t.color).toUpperCase()));
    setColor(SWATCHES.find((c) => !used.has(c)) || SWATCHES[0]);
    setAdding(true);
  };

  const add = async (e) => {
    e?.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await createTag({ name: name.trim(), color });
      setAdding(false);
      load();
    } catch (err) {
      notify.error(errorWords(err, 'save the tag'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t) => {
    const ok = await confirmDialog({ title: `Delete ${t.name}?`, message: 'It comes off everyone who has it.', confirmLabel: 'Delete tag' });
    if (!ok) return;
    try {
      await deleteTag(t.id);
      notify.success(`${t.name} deleted`);
      load();
    } catch (err) {
      notify.error(errorWords(err, 'delete the tag'));
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tags || []).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  }, [tags, q]);

  if (!tags && loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (!tags) return <SkeletonCard lines={4} />;
  return (
    <div className="space-y-6 pb-8">
      <ListHeader
        section="Settings"
        entity="settings"
        title="Tags"
        description="Free labels to group people for filters, announcements and reports. Tags never change pay or access."
        primary={{ label: 'Add tag', icon: Plus, onClick: open }}
        toolbar={tags.length ? <SearchField value={q} onSearch={setQ} placeholder="Search tags" label="Search tags" className="w-full sm:w-80" /> : null}
        toolbarEnd={tags.length ? <span className="ui-caption tabular-nums">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span> : null}
      />
      {!tags.length ? (
        <EmptyState title="No tags yet" description="Add one, then pick it on an employee's file." action={<button type="button" className="ui-btn ui-btn-primary" onClick={open}>Add tag</button>} />
      ) : !shown.length ? (
        <p className="ui-muted text-sm">No tag matches “{q}”.</p>
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Added</th>
                <th scope="col" className="w-12"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="people-tag-chip">
                      <span className="people-tag-dot" style={{ background: dotColour(t.color) }} aria-hidden="true" />
                      {t.name}
                    </span>
                  </td>
                  <td className="ui-muted tabular-nums">{t.createdAt ? formatDate(String(t.createdAt).slice(0, 10)) : '—'}</td>
                  <td className="text-right">
                    <button type="button" className="ui-icon-btn" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <Drawer
          open
          onClose={() => setAdding(false)}
          widthClass="w-[min(28rem,96vw)] ui-drawer-sheet"
          title="Add tag"
          dirty={Boolean(name.trim())}
          footer={<>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            <Button variant="primary" loading={saving} disabled={!name.trim()} type="submit" form="tag-form">Add tag</Button>
          </>}
        >
          <form id="tag-form" onSubmit={add} className="grid gap-4">
            <label className="block">
              <span className="ui-label">Name *</span>
              <input className="ui-input w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="Night shift eligible" />
            </label>
            <div>
              <span className="ui-label" id="tag-colour">Colour</span>
              <div role="radiogroup" aria-labelledby="tag-colour" className="flex flex-wrap gap-2 pt-1">
                {SWATCHES.map((c, i) => (
                  <button key={c} type="button" role="radio" aria-checked={color === c} className="people-tag-swatch" onClick={() => setColor(c)}>
                    <span className="people-tag-dot" style={{ background: dotColour(c) }} aria-hidden="true" />{SWATCH_NAMES[i]}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </Drawer>
      ) : null}
    </div>
  );
}
