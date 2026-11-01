import React, { useMemo, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import MasterFormPage from '@ui/components/MasterFormPage';

const safeArray = (v) => (Array.isArray(v) ? v : []);

export const AccountGroupForm = ({ db, setDb, currentCompany, initialData = null, onClose, fullPage = false }) => {
  const isEdit = Boolean(initialData && initialData.id);

  const accountTypes = useMemo(() => {
    return safeArray(db.accountTypes)
      .filter((t) => t.companyId === currentCompany.id)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.accountTypes, currentCompany.id]);

  const groups = useMemo(() => {
    return safeArray(db.accountGroups)
      .filter((g) => g.companyId === currentCompany.id && !g.isLegacy)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.accountGroups, currentCompany.id]);

  const unavailableGroupIds = useMemo(() => {
    if (!isEdit) return new Set();
    const unavailable = new Set([String(initialData.id)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of groups) {
        if (unavailable.has(String(group.parentGroupId)) && !unavailable.has(String(group.id))) {
          unavailable.add(String(group.id));
          changed = true;
        }
      }
    }
    return unavailable;
  }, [groups, initialData, isEdit]);

  const [formData, setFormData] = useState(() => {
    if (isEdit) {
      return {
        name: String(initialData?.name || ''),
        under: initialData?.parentGroupId
          ? `group:${String(initialData.parentGroupId)}`
          : `type:${String(initialData?.typeId || '')}`,
      };
    }

    const defaultType = accountTypes[0]?.id ? String(accountTypes[0].id) : '';
    return {
      name: '',
      under: defaultType ? `type:${defaultType}` : '',
    };
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const name = String(formData.name || '').trim();
    const [underKind, underId] = String(formData.under || '').split(':');
    const parentGroup = underKind === 'group' ? groups.find((group) => String(group.id) === underId) : null;
    const parentType = underKind === 'type' ? accountTypes.find((type) => String(type.id) === underId) : null;
    const typeId = String(parentGroup?.typeId ?? parentType?.id ?? '').trim();

    if (!typeId) {
      notify.error('Select the group this ledger group is under');
      return;
    }
    if (!name) {
      notify.error('Group name is required');
      return;
    }

    const clash = groups.some(
      (g) =>
        String(g.name || '').trim().toLowerCase() === name.toLowerCase() &&
        (!isEdit || String(g.id) !== String(initialData.id))
    );
    if (clash) {
      notify.error('A ledger group with this name already exists');
      return;
    }

    const parentGroupId = parentGroup?.id ?? null;
    const groupCategory = String(parentGroup?.groupCategory || initialData?.groupCategory || 'General').trim() || 'General';

    const nextId = groups.reduce((m, g) => Math.max(m, Number(g?.id || 0)), 0) + 1;

    if (isEdit) {
      const updated = {
        ...initialData,
        typeId: Number(typeId),
        name,
        parentGroupId,
        groupCategory,
        isUserDefined: true,
        updatedAt: new Date().toISOString(),
      };

      const originalName = String(initialData?.name || '').trim().toLowerCase();
      const renamedSystemGroup = Boolean(initialData?.isSystem && originalName && originalName !== name.toLowerCase());
      const companies = renamedSystemGroup
        ? safeArray(db.companies).map((company) => {
            if (company.id !== currentCompany.id) return company;
            const removed = new Set(
              safeArray(company?.docSettings?.deletedDefaultAccountGroups).map((value) =>
                String(value || '').trim().toLowerCase()
              )
            );
            removed.add(originalName);
            return {
              ...company,
              docSettings: {
                ...(company.docSettings || {}),
                deletedDefaultAccountGroups: [...removed],
              },
            };
          })
        : db.companies;

      setDb({
        ...db,
        companies,
        accountGroups: safeArray(db.accountGroups).map((g) =>
          g.companyId === currentCompany.id && String(g.id) === String(initialData.id) ? updated : g
        ),
      });

      onClose?.();
      return;
    }

    const newGroup = {
      id: nextId,
      companyId: currentCompany.id,
      typeId: Number(typeId),
      name,
      parentGroupId,
      groupCategory,
      isUserDefined: true,
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      accountGroups: [...safeArray(db.accountGroups), newGroup],
    });

    onClose?.();
  };

  const fields = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="ui-label" htmlFor="accountgrouptypeforms-ledger-group-name">Ledger Group Name *</label>
          <input
            id="accountgrouptypeforms-ledger-group-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
            className="ui-input w-full"
            placeholder="e.g., Digital Banks"
            required
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="accountgrouptypeforms-under">Under *</label>
          <select
            id="accountgrouptypeforms-under"
            value={formData.under}
            onChange={(e) => setFormData((p) => ({ ...p, under: e.target.value }))}
            className="ui-select w-full"
            required
          >
            <option value="">Select parent group</option>
            <optgroup label="Primary Groups">
              {accountTypes.map((type) => (
                <option key={`type:${type.id}`} value={`type:${type.id}`}>
                  {type.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Ledger Groups">
              {groups.filter((group) => !unavailableGroupIds.has(String(group.id))).map((group) => (
                <option key={`group:${group.id}`} value={`group:${group.id}`}>
                  {group.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* On a screen the bar carries these; in a dialog they are the only way
          out and stay at the foot. */}
      {fullPage ? null : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border ui-hover-sunken">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
            {isEdit ? 'Save changes' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className={fullPage ? '' : 'space-y-4'}>
      {fullPage ? (
        <MasterFormPage
          title={isEdit ? 'Edit Ledger Group' : 'New Ledger Group'}
          subtitle="Create a group under a primary group or another ledger group."
          onBack={onClose}
          primaryLabel={isEdit ? 'Save changes' : 'Save'}
          heading="Ledger Group Details"
          description="The selected parent controls where this group appears in the financial statements."
        >
          {fields}
        </MasterFormPage>
      ) : (
        fields
      )}
    </form>
  );
};
