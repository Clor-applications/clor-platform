import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Building2, ChevronRight, CornerDownRight, Download, FileText, Landmark, Pencil, Plus, Receipt } from 'lucide-react';

import { formatMoney, formatMoneyCompact } from '@ui/utils/money';
import { EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { createCompany } from '../../api/auth';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * The company group viewer.
 *
 * One workspace can hold several companies — a parent with subsidiaries, or
 * sibling firms under one proprietor. Until now the app silently used the
 * first company in the list; this page makes the group visible: hierarchy,
 * per-company activity, group rollups, and switching which company the rest
 * of the product operates on.
 *
 * Hierarchy is client-side (`parentCompanyId` on the company record). Cycles
 * are refused at edit time, and a child whose parent was deleted renders as a
 * root rather than vanishing.
 */

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export default function CompanyGroups({ db, setDb, currentCompany, onSwitched, initialAction = null, onActionConsumed = null }) {
  const companies = useMemo(
    () => (Array.isArray(db?.companies) ? db.companies : []),
    [db]
  );

  const [editing, setEditing] = useState(null); // { id? , parentCompanyId? } — no id = create
  const [creating, setCreating] = useState(false);
  // Arriving from "Add company" elsewhere should land on the form, not on the
  // list with the same click still to make.
  const initialActionRef = useRef(initialAction);
  /*
   * The company being looked at, as opposed to the one being edited.
   * Branches and warehouses both open what was saved; a company dropped you
   * back on the list with a toast, so the only way to see what had actually
   * been stored was to find the row again and press the pencil.
   */
  const [viewingId, setViewingId] = useState(null);
  const [form, setForm] = useState({ name: '', gstin: '', state: '', parentCompanyId: '' });

  /** Billed / outstanding per company, from its invoices. */
  const activityById = useMemo(() => {
    const map = new Map();
    for (const c of companies) map.set(c.id, { billed: 0, outstanding: 0, docs: 0 });
    for (const inv of Array.isArray(db?.invoices) ? db.invoices : []) {
      const slot = map.get(inv.companyId);
      if (!slot) continue;
      const st = String(inv.status || '').toLowerCase();
      if (st === 'draft' || st === 'cancelled') continue;
      slot.docs += 1;
      slot.billed += num(inv.total);
      slot.outstanding += Math.max(0, num(inv.total) - num(inv.paidAmount));
    }
    return map;
  }, [companies, db]);

  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  /** Roots (no parent, or parent missing) with children attached, any depth. */
  const tree = useMemo(() => {
    const children = new Map();
    for (const c of companies) {
      const pid = c.parentCompanyId;
      const validParent = pid != null && pid !== '' && byId.has(pid) && pid !== c.id;
      const key = validParent ? pid : null;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(c);
    }
    const attach = (c) => ({ company: c, children: (children.get(c.id) || []).map(attach) });
    return (children.get(null) || []).map(attach);
  }, [companies, byId]);

  /** Rollup includes the company and every descendant. */
  const rollup = (node) => {
    const own = activityById.get(node.company.id) || { billed: 0, outstanding: 0, docs: 0 };
    return node.children.reduce(
      (acc, child) => {
        const r = rollup(child);
        return { billed: acc.billed + r.billed, outstanding: acc.outstanding + r.outstanding, docs: acc.docs + r.docs };
      },
      { ...own }
    );
  };

  /*
   * The group's own figures.
   *
   * A page that lists companies is opened to answer a question about the
   * group, not about any one of them: what the whole thing has billed, what is
   * still owed to it, and how many of its companies are actually registered —
   * an unregistered company cannot raise a tax invoice, which is the sort of
   * thing that should not need looking up company by company.
   */
  const groupTotals = useMemo(() => {
    let billed = 0;
    let outstanding = 0;
    let registered = 0;
    let docs = 0;
    for (const c of companies) {
      const act = activityById.get(c.id) || { billed: 0, outstanding: 0, docs: 0 };
      billed += act.billed;
      outstanding += act.outstanding;
      docs += act.docs;
      if (String(c.gstin || '').trim()) registered += 1;
    }
    return { companies: companies.length, billed, outstanding, registered, unregistered: companies.length - registered, docs };
  }, [companies, activityById]);

  /*
   * Search is here for the group that has grown — a CA firm's twenty clients,
   * a proprietor's four firms. It matches the name, the GSTIN and the state,
   * which is how somebody actually looks for a company.
   */
  const [query, setQuery] = useState('');
  /*
   * The tree, narrowed by the search — a parent stays when one of its
   * subsidiaries matches, because dropping it would leave the child floating
   * with no indication of what it belongs to.
   */
  const visibleTree = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    const keep = (node) => {
      const kids = node.children.map(keep).filter(Boolean);
      const hit = [node.company.name, node.company.gstin, node.company.state].some((v) =>
        String(v || '').toLowerCase().includes(q)
      );
      return hit || kids.length ? { ...node, children: kids } : null;
    };
    return tree.map(keep).filter(Boolean);
  }, [tree, query]);

  const wouldCycle = (companyId, candidateParentId) => {
    let cur = candidateParentId;
    const seen = new Set();
    while (cur != null && cur !== '' && !seen.has(cur)) {
      if (cur === companyId) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentCompanyId;
    }
    return false;
  };

  /*
   * The create form existed but nothing opened it: `setEditing` was only ever
   * called with an id. So the app had no way to add a company at all — the
   * only one you could ever have was the one signup made.
   */
  const openCreate = () => {
    setViewingId(null);
    setEditing({});
    setForm({ name: '', gstin: '', state: '', parentCompanyId: '' });
  };

  useEffect(() => {
    if (initialActionRef.current !== 'create') return;
    initialActionRef.current = null;
    openCreate();
    // Spent. Coming back to this screen later should show the list, not the
    // form again.
    onActionConsumed?.();
    // Runs once, for the arriving intent.
  }, []);

  const openEdit = (c) => {
    setEditing({ id: c.id });
    setForm({
      name: c.name || '',
      gstin: c.gstin || '',
      state: c.state || '',
      parentCompanyId: c.parentCompanyId != null ? String(c.parentCompanyId) : '',
    });
  };

  const save = () => {
    const name = form.name.trim();
    if (!name) {
      notify.error('The company needs a name.');
      return;
    }
    const parentRaw = String(form.parentCompanyId || '').trim();
    const parentCompanyId = parentRaw === '' ? null : Number(parentRaw);

    if (editing?.id != null) {
      if (parentCompanyId != null && wouldCycle(editing.id, parentCompanyId)) {
        notify.error('That parent would make the company its own ancestor.');
        return;
      }
      setDb((prev) => ({
        ...prev,
        companies: (prev.companies || []).map((c) =>
          c.id === editing.id
            ? { ...c, name, gstin: form.gstin.trim(), state: form.state.trim(), parentCompanyId }
            : c
        ),
      }));
      notify.success(`${name} saved.`);
      setViewingId(editing.id);
      setEditing(null);
      return;
    }

    /*
     * A new company is created on the SERVER first, and only written locally
     * if that succeeded.
     *
     * The org is what the company actually is: it owns the branches, the
     * warehouses and every document raised under it. A company appended only
     * to the browser store has no `backendCompanyId`, so `resolveServerOrgId`
     * falls back to the session's `activeOrgId` — and the second company would
     * quietly read and write the first company's data while showing its own
     * name at the top of the screen. Better to fail the create than to make
     * that.
     */
    const state = form.state.trim();
    if (!state) {
      notify.error('Choose the state the company is registered in — it decides how GST splits.');
      return;
    }

    setCreating(true);
    createCompany({ companyName: name, state, gstin: form.gstin.trim().toUpperCase() || null })
      .then((res) => {
        const backendCompanyId = String(res?.company?.orgId || res?.company?.id || '').trim();
        if (!backendCompanyId) throw new Error('The server did not return the new company.');

        let allottedId = null;
        setDb((prev) => {
          const list = Array.isArray(prev.companies) ? prev.companies : [];
          allottedId = list.reduce((m, c) => Math.max(m, num(c.id)), 0) + 1;
          return {
            ...prev,
            companies: [
              ...list,
              {
                id: allottedId,
                name,
                gstin: form.gstin.trim().toUpperCase(),
                state,
                parentCompanyId,
                currency: 'INR',
                profile: {
                  backendCompanyId,
                  backendBranchId: res?.branch?.id || null,
                },
                createdAt: new Date().toISOString(),
              },
            ],
          };
        });
        notify.success(`${name} added to the group.`);
        setViewingId(allottedId);
        setEditing(null);
      })
      .catch((e) => {
        notify.error(String(e?.message || 'Could not add the company.'));
      })
      .finally(() => setCreating(false));
  };

  const viewingCompany = viewingId == null ? null : companies.find((c) => c.id === viewingId) || null;

  const setActive = (c) => {
    setDb((prev) => ({ ...prev, activeCompanyId: c.id }));
    notify.success(`Now working in ${c.name}. Every module reads this company.`);
    onSwitched?.(c);
  };

  const CompanyCard = ({ node, depth }) => {
    const c = node.company;
    const act = activityById.get(c.id) || { billed: 0, outstanding: 0, docs: 0 };
    const isActive = c.id === currentCompany?.id;
    const isGroupHead = node.children.length > 0;
    const roll = isGroupHead ? rollup(node) : null;

    return (
      <div style={{ marginLeft: depth ? '1.75rem' : 0 }}>
        <div className={`ui-card ui-lift mb-3 flex flex-wrap items-center gap-4 p-4 ${isActive ? 'ring-1 ring-[rgb(var(--brand))]' : ''}`}>
          {depth > 0 ? <CornerDownRight size={16} className="ui-subtle -ml-1 flex-shrink-0" aria-hidden="true" /> : null}
          <span
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}
            aria-hidden="true"
          >
            <Building2 size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {isActive ? <StatusPill status="Active" /> : null}
              {isGroupHead ? (
                <span className="ui-caption">
                  {node.children.length} subsidiar{node.children.length === 1 ? 'y' : 'ies'}
                </span>
              ) : null}
            </div>
            <div className="ui-caption mt-0.5">
              {c.gstin ? (
                [`GSTIN ${c.gstin}`, c.state].filter(Boolean).join(' · ')
              ) : (
                /*
                 * Said whether or not the state is known. A company with no
                 * GSTIN cannot raise a tax invoice at all, and the old line
                 * only mentioned it when the state was missing too — so the
                 * company that had one but not the other looked complete.
                 */
                <>
                  <span style={{ color: 'rgb(var(--warn-ink))' }}>No GSTIN — cannot raise a tax invoice</span>
                  {c.state ? <span> · {c.state}</span> : null}
                </>
              )}
            </div>
          </div>

          {/*
            The figures, right-aligned in fixed columns so a row of companies
            reads down as well as across. They were three loose spans that
            moved with the length of the name beside them, which is unreadable
            the moment there are four companies.
          */}
          <div className="flex items-center gap-5 text-sm">
            <span className="w-24 text-right">
              <span className="ui-caption block">Billed</span>
              <span className="ui-col-amount tabular-nums" title={formatMoney(act.billed, c)}>
                {formatMoneyCompact(act.billed, c)}
              </span>
            </span>
            <span className="w-24 text-right">
              <span className="ui-caption block">Outstanding</span>
              <span
                className={`ui-col-amount tabular-nums ${act.outstanding > 0 ? 'ui-amount-neg' : ''}`}
      title={formatMoney(act.outstanding, c)}
              >
                {formatMoneyCompact(act.outstanding, c)}
              </span>
            </span>
            {/* Only where it says something the row does not: a company with
                subsidiaries carries their money too. */}
            {roll ? (
              <span className="w-24 text-right">
                <span className="ui-caption block whitespace-nowrap">Group total</span>
                <span className="ui-col-amount tabular-nums" title={formatMoney(roll.billed, c)}>
                  {formatMoneyCompact(roll.billed, c)}
                </span>
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {!isActive ? (
              <button type="button" onClick={() => setActive(c)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                Set active <ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setViewingId(c.id)}
              className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
            >
              View
            </button>
            <button type="button" onClick={() => openEdit(c)} className="ui-icon-btn ui-btn-sm !w-8" aria-label={`Edit ${c.name}`}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {node.children.map((child) => (
          <CompanyCard key={child.company.id} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  };

  return (
    <DocumentListShell
      entity="company"
      title="Companies"
      company={currentCompany}
      surface="plain"
      search={{
        value: query,
        onChange: setQuery,
        placeholder: 'Search companies…',
        label: 'Search companies',
      }}
      moreItems={[exportMenuItem('Export companies')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Companies',
          fileName: 'Companies',
          label: 'company/companies',
          columns: [
            { key: 'name', label: 'Company' },
            { key: 'gstin', label: 'GSTIN' },
            { key: 'state', label: 'State' },
            {
              key: 'parent',
              label: 'Parent',
              value: (c) => (companies.find((x) => x.id === c.parentCompanyId) || {}).name || '',
            },
            { key: 'billed', label: 'Billed', value: (c) => (activityById.get(c.id) || {}).billed || 0 },
            { key: 'outstanding', label: 'Outstanding', value: (c) => (activityById.get(c.id) || {}).outstanding || 0 },
          ],
          rows: companies,
        });
      }}
      primary={
        /*
          Hidden while the editor is open: the form already carries the Add
          company button, and two controls with the same name doing different
          things is the one-primary-action rule broken twice over.
        */
        editing ? null : (
          <button type="button" onClick={openCreate} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add company
          </button>
        )
      }
      cards={[
        { label: 'Companies', value: groupTotals.companies, count: true, tone: 'draft', Icon: Building2 },
        { label: 'GST registered', value: groupTotals.registered, count: true, tone: 'paid', Icon: Landmark },
        { label: 'Not registered', value: groupTotals.unregistered, count: true, tone: 'cancelled', Icon: Ban },
        { label: 'Billed by the group', value: groupTotals.billed, tone: 'sent', Icon: Receipt },
        { label: 'Owed to the group', value: groupTotals.outstanding, tone: 'outstanding', Icon: FileText },
      ]}
      denseCards
      tip={{
        storageKey: 'clor.tip.companies',
        Icon: Building2,
        text: 'Every screen in the product works on the active company — set it here, and the books, documents and reports follow.',
      }}
    >
      {/*
        What was just saved, in the shape branches and warehouses already use:
        the record's own details, with the way back and the way to edit it in
        the same place. Hidden while the editor is open, because the editor is
        already showing the same record.
      */}
      {viewingCompany && !editing ? (
        <section className="ui-card ui-in p-5" aria-label="Company details">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="ui-t-sec truncate">{viewingCompany.name}</h3>
              <p className="ui-caption">
                {[viewingCompany.state, viewingCompany.gstin || 'No GSTIN'].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => openEdit(viewingCompany)} className="ui-btn ui-btn-secondary">
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
              <button type="button" onClick={() => setViewingId(null)} className="ui-btn ui-btn-ghost">
                Close
              </button>
            </div>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Name', viewingCompany.name],
              ['State', viewingCompany.state || '—'],
              ['GSTIN', viewingCompany.gstin || 'Not registered'],
              ['Currency', viewingCompany.currency || 'INR'],
              [
                'Parent',
                (companies.find((c) => c.id === viewingCompany.parentCompanyId) || {}).name || 'None — top of the group',
              ],
              ['Billed', formatMoney((activityById.get(viewingCompany.id) || {}).billed || 0, viewingCompany)],
              [
                'Outstanding',
                formatMoney((activityById.get(viewingCompany.id) || {}).outstanding || 0, viewingCompany),
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="ui-detail-label">{k}</dt>
                <dd className="ui-detail-value mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {editing ? (
        <div className="ui-card ui-in p-5">
          <h3 className="ui-t-sec mb-3">{editing.id != null ? 'Edit company' : 'New company'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="ui-label" htmlFor="company-name">Name</label>
              <input id="company-name" type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="ui-input" autoFocus />
            </div>
            <div>
              <label className="ui-label" htmlFor="company-gstin">GSTIN (optional)</label>
              <input id="company-gstin" type="text" value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value }))} className="ui-input" placeholder="27ABCDE1234F1Z5" />
            </div>
            <div>
              <label className="ui-label" htmlFor="company-state">State</label>
              <select id="company-state" value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} className="ui-select">
                <option value="">Select state</option>
                {Object.values(GST_STATE_BY_CODE).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="company-parent">Parent company</label>
              <select
                id="company-parent"
                value={form.parentCompanyId}
                onChange={(e) => setForm((p) => ({ ...p, parentCompanyId: e.target.value }))}
                className="ui-select"
              >
                <option value="">None — top-level company</option>
                {companies
                  .filter((c) => c.id !== editing.id)
                  .map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="ui-btn ui-btn-secondary" disabled={creating}>
              Cancel
            </button>
            <button type="button" onClick={save} className="ui-btn ui-btn-primary" disabled={creating}>
              {editing.id != null ? 'Save changes' : creating ? 'Adding…' : 'Add company'}
            </button>
          </div>
        </div>
      ) : null}

      {visibleTree.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={Building2}
            kind="new"
      title={companies.length ? 'No company matches' : 'No companies yet'}
            description={
              companies.length
                ? 'Nothing in the group matches that search — try the name, the GSTIN or the state.'
                : 'A company is a set of books: its own documents, its own ledger, its own GST returns. Add the first to start the group.'
            }
            routes={
              companies.length
                ? undefined
                : [
                    {
                      label: 'Add a company',
                      description: 'Name it, and give it a GSTIN if it has one.',
                      onSelect: () => openCreate(),
                    },
                  ]
            }
          />
        </div>
      ) : (
        <div>
          {visibleTree.map((node) => (
            <CompanyCard key={node.company.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </DocumentListShell>
  );
}
