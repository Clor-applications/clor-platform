import React, { useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import { Menu, MenuItem, MenuPanel, MenuSeparator, MenuTrigger } from '@ui/components/ui/Menu';
import { Bookmark, Check, ChevronDown, Plus, Trash2 } from '@ui/components/ui/lineIcons';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import useRequest from '@ui/components/ui/useRequest';
import { errorWords } from '@ui/utils/errorWords';
import { deleteReportView, listReportViews, saveReportView } from '../api/hrReports';

/*
 * Saved views on a report (PRD RPT-02): the dates, grouping and filters on
 * screen under a name, kept on the server so they open on any device. The
 * person's own first, then the ones shared with them; only the maker deletes.
 * Dates are kept only when the reader set them, so a view saved on the
 * report's own period keeps moving with the calendar.
 */
export default function ReportViews({ report, current, activeId, onApply, canShare = true }) {
  const views = useRequest(() => listReportViews(report), [report]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(null);
  const list = views.data || [];
  const active = list.find((v) => v.id === activeId) || null;

  const save = async () => {
    try {
      const v = await saveReportView({ screen: `report:${report}`, name: naming.name, shared: naming.shared, filters: current });
      notify.success(`View "${v.name}" saved`);
      setNaming(null);
      views.reload();
      onApply(v);
    } catch (e) {
      notify.error(errorWords(e, 'save the view'));
    }
  };
  const remove = async (v) => {
    if (!(await confirmDialog({ title: `Delete the view "${v.name}"?`, message: 'The dates and filters it keeps go; the report itself does not change.', confirmLabel: 'Delete view' }))) return;
    try {
      await deleteReportView(v.id);
      notify.success(`View "${v.name}" deleted`);
      views.reload();
    } catch (e) {
      notify.error(errorWords(e, 'delete it'));
    }
  };

  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger className="ui-btn ui-btn-secondary" aria-label={active ? `Saved views, showing ${active.name}` : 'Saved views'}>
          <Bookmark size={16} aria-hidden="true" /> <span className="max-w-40 truncate">{active ? active.name : 'Views'}</span> <ChevronDown size={16} aria-hidden="true" />
        </MenuTrigger>
        <MenuPanel aria-label="Saved views" align="end" minWidth={248}>
          {list.map((v) => (
            <MenuItem key={v.id} onClick={() => onApply(v)}>
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {v.shared && !v.mine ? <span className="ui-caption">Shared</span> : null}
              {v.id === activeId ? <Check size={16} aria-label="Showing now" /> : null}
            </MenuItem>
          ))}
          {!list.length ? <div className="ui-caption px-3 py-2">{views.error ? 'Saved views could not load.' : 'No saved views yet.'}</div> : null}
          <MenuSeparator />
          <MenuItem onClick={() => setNaming({ name: '', shared: false })}><Plus size={16} aria-hidden="true" /> Save current view</MenuItem>
          {active?.mine ? <MenuItem onClick={() => remove(active)}><Trash2 size={16} aria-hidden="true" /> Delete “{active.name}”</MenuItem> : null}
        </MenuPanel>
      </Menu>
      {naming ? (
        <Drawer open onClose={() => setNaming(null)} widthClass="w-[min(36rem,96vw)]" title="Save current view" dirty={Boolean(naming.name)}
          footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setNaming(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={!naming.name.trim()} onClick={save}>Save</button></>}>
          <div className="grid gap-4">
            <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={80} value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} placeholder="Sales, by branch" data-autofocus /></label>
            {canShare ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={naming.shared} onChange={(e) => setNaming({ ...naming, shared: e.target.checked })} />Share with everyone who can open this report</label> : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
