import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { Button, SkeletonCard, EmptyState, useDoneFlash } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createTag, deleteTag, listTags } from '@ui/personnel/api';

/* The categorical series (rnd.css --cat-1..8), stored as hex because a tag keeps its colour. */
const SWATCHES = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];

/** Labels for grouping people — Remote, Night shift, Key person. */
export default function Tags() {
  const [tags, setTags] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [adding, setAdding] = useState(false);
  /* No toast here: the new tag appearing below is the answer, and "Added" on the button says it happened. */
  const [added, flashAdded] = useDoneFlash();

  const load = useCallback(() => listTags().then(setTags).catch((e) => notify.error(String(e?.message || 'Could not load tags.'))), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (adding || !name.trim()) return;
    setAdding(true);
    try {
      await createTag({ name: name.trim(), color });
      setName('');
      flashAdded();
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Tag not saved.'));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (t) => {
    const ok = await confirmDialog({ title: `Delete ${t.name}?`, message: 'It comes off everyone who has it.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    await deleteTag(t.id).catch((err) => notify.error(String(err?.message || 'Could not delete.')));
    load();
  };

  if (!tags) return <SkeletonCard lines={4} />;
  return (
    <div className="space-y-6">
      <SettingsScreenHeader entity="settings" title="Tags" description="Labels for grouping people — Remote, Night shift, Key person." />
      <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="ui-label">New tag</span>
          <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div role="radiogroup" aria-label="Colour" className="flex gap-1.5 pb-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className="h-6 w-6 rounded-full"
              style={{ backgroundColor: c, outline: color === c ? '2px solid rgb(var(--fg))' : 'none', outlineOffset: 2 }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <Button type="submit" variant="primary" icon={Plus} loading={adding} done={added} doneLabel="Added" disabled={!name.trim() && !adding && !added}>
          Add
        </Button>
      </form>
      {tags.length ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="ui-pill inline-flex items-center gap-1" style={{ backgroundColor: `${t.color}22`, color: `color-mix(in srgb, ${t.color} 55%, #000)` }}>
              {t.name}
              <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No tags yet" description="Add one above, then pick it on an employee's file." />
      )}
    </div>
  );
}
