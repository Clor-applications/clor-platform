import React, { useEffect, useState } from 'react';
import { Check, Layers, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { listRoles, listUsers } from '../../api/admin';
import {
  addUserRestriction,
  assignRoleProfiles,
  createApprovalRule,
  createRoleProfile,
  deleteApprovalRule,
  deleteRoleProfile,
  getApprovalRules,
  getRoleProfiles,
  getUserRestrictions,
  removeUserRestriction,
} from '../../api/governance';
import { EmptyState, Spinner, SkeletonCard } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '../settings/SettingsScreenHeader';
import { orgId as platformOrgId } from '@platform/context';

const TABS = [
  { key: 'profiles', label: 'Role profiles' },
  { key: 'rules', label: 'Approval rules' },
  { key: 'restrictions', label: 'Document restrictions' },
];

const ENTITY_TYPES = [
  { key: 'CUSTOMER', label: 'Customer' },
  { key: 'VENDOR', label: 'Vendor' },
  { key: 'COST_CENTRE', label: 'Cost centre' },
  { key: 'ITEM_GROUP', label: 'Item group' },
];

/** Role profiles, approval thresholds and per-user document restrictions. */
export const GovernanceSettings = () => {
  const [tab, setTab] = useState('profiles');

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [rules, setRules] = useState([]);

  const [newProfile, setNewProfile] = useState({ name: '', roleIds: [] });
  const [newRule, setNewRule] = useState({ docType: 'INVOICE', name: '', minAmount: 50000, approverRoleId: '' });

  const [restrictUser, setRestrictUser] = useState('');
  const [restrictions, setRestrictions] = useState([]);
  const [newRestriction, setNewRestriction] = useState({ entityType: 'CUSTOMER', entityId: '', label: '' });
  const [profileAssign, setProfileAssign] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const orgId = String(platformOrgId() || '');

  const reload = () =>
    Promise.all([listRoles(orgId), listUsers(orgId), getRoleProfiles(), getApprovalRules()]).then(
      ([r, u, p, ru]) => {
        setRoles(r?.roles || []);
        setUsers(u?.users || []);
        setProfiles(p?.profiles || []);
        setRules(ru?.rules || []);
      }
    );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(reload)
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restrictUser) {
      setRestrictions([]);
      return;
    }
    getUserRestrictions(restrictUser)
      .then((d) => setRestrictions(d?.permissions || []))
      .catch((e) => setError(String(e?.message || e)));
  }, [restrictUser]);

  const run = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (note) setNotice(note);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <SkeletonCard lines={4} />
    );
  }

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Governance"
        actions={
          notice ? (
            <span className="ui-pill ui-pill-pos" role="status">
              <Check size={11} aria-hidden="true" /> {notice}
            </span>
          ) : null
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`ui-btn ${tab === t.key ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profiles' ? (
        <div className="space-y-3">
          {profiles.length === 0 ? (
            <div className="ui-card">
              <EmptyState
                icon={Layers}
      title="No role profiles yet"
                description="A profile bundles several roles so a new joiner gets one assignment instead of five."
              />
            </div>
          ) : (
            profiles.map((p) => (
              <div key={p.id} className="ui-card p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="ui-title text-sm">{p.name}</div>
                  <div className="ui-muted text-xs mt-0.5">
                    {p.roles.map((r) => r.name).join(', ') || 'No roles'} · {p.assignedUsers} user(s)
                  </div>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost"
                  onClick={() => run('delp', async () => { await deleteRoleProfile(p.id); await reload(); }, 'Removed')}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))
          )}

          <div className="ui-card p-4 space-y-3">
            <div className="ui-title text-sm">New profile</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="ui-label" htmlFor="prof-name">Name</label>
                <input
                  id="prof-name"
                  className="ui-input"
                  value={newProfile.name}
                  onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                  placeholder="Front office"
                />
              </div>
              <div>
                <span className="ui-label">Roles in this profile</span>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={newProfile.roleIds.includes(r.id)}
                        onChange={(e) =>
                          setNewProfile((prev) => ({
                            ...prev,
                            roleIds: e.target.checked
                              ? [...prev.roleIds, r.id]
                              : prev.roleIds.filter((x) => x !== r.id),
                          }))
                        }
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!newProfile.name || newProfile.roleIds.length === 0 || busy === 'prof'}
              onClick={() =>
                run('prof', async () => {
                  await createRoleProfile(newProfile);
                  setNewProfile({ name: '', roleIds: [] });
                  await reload();
                }, 'Profile created')
              }
            >
              {busy === 'prof' ? <Spinner /> : <Plus size={16} aria-hidden="true" />} Create profile
            </button>
          </div>

          {profiles.length && users.length ? (
            <div className="ui-card p-4 space-y-3">
              <div className="ui-title text-sm">Assign profiles to a user</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select className="ui-select" value={restrictUser} onChange={(e) => setRestrictUser(e.target.value)}>
                  <option value="">Choose a user…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName || u.name} — {u.email}
                    </option>
                  ))}
                </select>
                <div className="space-y-1">
                  {profiles.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={profileAssign.includes(p.id)}
                        onChange={(e) =>
                          setProfileAssign((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={!restrictUser || busy === 'assign'}
                onClick={() =>
                  run('assign', async () => {
                    await assignRoleProfiles(restrictUser, profileAssign);
                    await reload();
                  }, 'Profiles assigned')
                }
              >
                Assign
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'rules' ? (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="ui-card">
              <EmptyState
                icon={ShieldCheck}
      title="No approval rules"
                description="A rule holds documents above an amount until someone with the approving role signs off."
              />
            </div>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="ui-card p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="ui-title text-sm">{r.name}</div>
                  <div className="ui-muted text-xs mt-0.5">
                    {r.docType.toLowerCase()} from {r.minAmount.toLocaleString('en-IN')}
                    {r.maxAmount ? ` to ${r.maxAmount.toLocaleString('en-IN')}` : ' upwards'} · approved by{' '}
                    {r.approverRoleName}
                  </div>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost"
                  onClick={() => run('delr', async () => { await deleteApprovalRule(r.id); await reload(); }, 'Removed')}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))
          )}

          <div className="ui-card p-4 space-y-3">
            <div className="ui-title text-sm">New rule</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="ui-label" htmlFor="rule-doc">Applies to</label>
                <select
                  id="rule-doc"
                  className="ui-select"
                  value={newRule.docType}
                  onChange={(e) => setNewRule({ ...newRule, docType: e.target.value })}
                >
                  <option value="INVOICE">Invoices</option>
                  <option value="BILL">Bills</option>
                  <option value="PAYMENT">Payments</option>
                  <option value="JOURNAL">Journals</option>
                </select>
              </div>
              <div>
                <label className="ui-label" htmlFor="rule-name">Name</label>
                <input
                  id="rule-name"
                  className="ui-input"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="Over 50,000"
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="rule-min">From amount</label>
                <input
                  id="rule-min"
                  type="number"
                  className="ui-input"
                  value={newRule.minAmount}
                  onChange={(e) => setNewRule({ ...newRule, minAmount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="rule-role">Approved by</label>
                <select
                  id="rule-role"
                  className="ui-select"
                  value={newRule.approverRoleId}
                  onChange={(e) => setNewRule({ ...newRule, approverRoleId: e.target.value })}
                >
                  <option value="">Choose a role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!newRule.name || !newRule.approverRoleId || busy === 'rule'}
              onClick={() =>
                run('rule', async () => {
                  await createApprovalRule(newRule);
                  setNewRule({ docType: 'INVOICE', name: '', minAmount: 50000, approverRoleId: '' });
                  await reload();
                }, 'Rule created')
              }
            >
              {busy === 'rule' ? <Spinner /> : <Plus size={16} aria-hidden="true" />} Create rule
            </button>
            <p className="ui-subtle text-xs">
              Someone who already holds the approving role is not asked to approve their own document.
            </p>
          </div>
        </div>
      ) : null}

      {tab === 'restrictions' ? (
        <div className="space-y-3">
          <div className="ui-card p-4 space-y-3">
            <div>
              <label className="ui-label" htmlFor="restrict-user">User</label>
              <select
                id="restrict-user"
                className="ui-select"
                value={restrictUser}
                onChange={(e) => setRestrictUser(e.target.value)}
              >
                <option value="">Choose a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName || u.name} — {u.email}
                  </option>
                ))}
              </select>
              <div className="ui-subtle text-xs mt-1">
                With no restrictions a user sees everything their permissions allow. Adding one narrows them to the
                listed records only.
              </div>
            </div>

            {restrictUser ? (
              <>
                {restrictions.length === 0 ? (
                  <div className="ui-muted text-sm">No restrictions — this user is not narrowed.</div>
                ) : (
                  <div className="space-y-1">
                    {restrictions.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="ui-pill ui-pill-neutral">{p.entityType}</span>{' '}
                          <span className="ui-mono text-xs">{p.entityId}</span>
                          {p.label ? <span className="ui-muted"> — {p.label}</span> : null}
                        </span>
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost !px-1.5"
                          onClick={() =>
                            run('delx', async () => {
                              await removeUserRestriction(restrictUser, p.id);
                              setRestrictions(await getUserRestrictions(restrictUser).then((d) => d?.permissions || []));
                            }, 'Removed')
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-4">
                  <select
                    className="ui-select"
                    value={newRestriction.entityType}
                    onChange={(e) => setNewRestriction({ ...newRestriction, entityType: e.target.value })}
                  >
                    {ENTITY_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="ui-input"
                    placeholder="Record ID"
                    value={newRestriction.entityId}
                    onChange={(e) => setNewRestriction({ ...newRestriction, entityId: e.target.value })}
                  />
                  <input
                    className="ui-input"
                    placeholder="Label (optional)"
                    value={newRestriction.label}
                    onChange={(e) => setNewRestriction({ ...newRestriction, label: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    disabled={!newRestriction.entityId || busy === 'restrict'}
                    onClick={() =>
                      run('restrict', async () => {
                        await addUserRestriction(
                          restrictUser,
                          newRestriction.entityType,
                          newRestriction.entityId,
                          newRestriction.label
                        );
                        setNewRestriction({ entityType: 'CUSTOMER', entityId: '', label: '' });
                        setRestrictions(await getUserRestrictions(restrictUser).then((d) => d?.permissions || []));
                      }, 'Restriction added')
                    }
                  >
                    Add
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default GovernanceSettings;
