import React from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';
import { SelectField } from '@ui/components/ui/SelectField';

/*
 * Where one person works, and as what.
 *
 * One row per branch with the role they hold there, and under it any
 * warehouse of that branch they may use. A warehouse can carry a role of its
 * own, which adds to the branch role at that warehouse only.
 *
 * `value` is what the server takes in one save:
 * { branches: [{ branchId, roleId }], warehouseIds: [], warehouseRoles: [{ warehouseId, roleId }] }.
 * Removing a branch removes its warehouses with it, so the three lists cannot
 * disagree.
 */

const id = (value) => String(value ?? '');
const label = (item) => item?.branchName || item?.warehouseName || item?.name || 'Unnamed';

export default function UserLocationAccessTable({ branches = [], warehouses = [], roles = [], value, onChange }) {
  const assignedBranches = value?.branches || [];
  const selectedWarehouseIds = value?.warehouseIds || [];
  const warehouseRoles = value?.warehouseRoles || [];
  const warehouseOf = (warehouseId) => warehouses.find((item) => id(item.id) === id(warehouseId));
  const availableBranches = branches.filter((branch) => !assignedBranches.some((row) => id(row.branchId) === id(branch.id)));
  const availableWarehouses = warehouses.filter(
    (warehouse) =>
      assignedBranches.some((row) => id(row.branchId) === id(warehouse.branchId)) &&
      !selectedWarehouseIds.some((warehouseId) => id(warehouseId) === id(warehouse.id))
  );

  /* Everything that hangs off a branch goes with it. */
  const withoutBranch = (branchId) => ({
    warehouseIds: selectedWarehouseIds.filter((warehouseId) => id(warehouseOf(warehouseId)?.branchId) !== branchId),
    warehouseRoles: warehouseRoles.filter((row) => id(warehouseOf(row.warehouseId)?.branchId) !== branchId),
  });
  const removeBranch = (branchId) =>
    onChange({ ...value, branches: assignedBranches.filter((row) => id(row.branchId) !== branchId), ...withoutBranch(branchId) });
  const changeBranch = (branchId, nextId) =>
    onChange({
      ...value,
      branches: assignedBranches.map((row) => (id(row.branchId) === branchId ? { branchId: nextId, roleId: '' } : row)),
      ...withoutBranch(branchId),
    });
  const setBranchRole = (branchId, roleId) =>
    onChange({ ...value, branches: assignedBranches.map((row) => (id(row.branchId) === branchId ? { ...row, roleId } : row)) });

  const removeWarehouse = (warehouseId) =>
    onChange({
      ...value,
      warehouseIds: selectedWarehouseIds.filter((item) => id(item) !== warehouseId),
      warehouseRoles: warehouseRoles.filter((row) => id(row.warehouseId) !== warehouseId),
    });
  const changeWarehouse = (warehouseId, nextId) =>
    onChange({
      ...value,
      warehouseIds: selectedWarehouseIds.map((item) => (id(item) === warehouseId ? nextId : item)),
      warehouseRoles: warehouseRoles.filter((row) => id(row.warehouseId) !== warehouseId),
    });
  const setWarehouseRole = (warehouseId, roleId) =>
    onChange({
      ...value,
      warehouseRoles: [...warehouseRoles.filter((row) => id(row.warehouseId) !== warehouseId), ...(roleId ? [{ warehouseId, roleId }] : [])],
    });

  const rows = [
    ...assignedBranches.map((row) => ({ type: 'Branch', branchId: id(row.branchId), roleId: id(row.roleId) })),
    ...selectedWarehouseIds.map((warehouseId) => ({
      type: 'Warehouse',
      branchId: id(warehouseOf(warehouseId)?.branchId),
      warehouseId: id(warehouseId),
      roleId: id(warehouseRoles.find((row) => id(row.warehouseId) === id(warehouseId))?.roleId),
    })),
  ];

  return (
    <section className="grid gap-3" aria-labelledby="ws-user-locations">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="ws-user-locations" className="ws-panel-title">Branches, warehouses and roles</h3>
          <p className="ui-caption">A role in each branch. A warehouse role adds to the branch role at that warehouse only.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="ws-btn ws-btn--quiet ws-btn--small"
            disabled={!availableBranches.length}
            onClick={() => onChange({ ...value, branches: [...assignedBranches, { branchId: id(availableBranches[0].id), roleId: '' }] })}
          >
            <Plus size={14} aria-hidden="true" /> Add branch
          </button>
          {warehouses.length ? (
            <button
              type="button"
              className="ws-btn ws-btn--quiet ws-btn--small"
              disabled={!availableWarehouses.length}
              onClick={() => onChange({ ...value, warehouseIds: [...selectedWarehouseIds, id(availableWarehouses[0].id)] })}
            >
              <Plus size={14} aria-hidden="true" /> Add warehouse
            </button>
          ) : null}
        </div>
      </div>
      <div className="ws-table-wrap">
        <table className="ws-table">
          <caption className="sr-only">Where this person works and the role they hold there</caption>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Branch</th>
              <th>Warehouse</th>
              <th>Role</th>
              <th><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const branch = branches.find((item) => id(item.id) === row.branchId);
              const warehouse = warehouseOf(row.warehouseId);
              /* A role made for one branch is offered only there. */
              const roleOptions = roles.filter((role) => !role.branchId || id(role.branchId) === row.branchId);
              const place = row.type === 'Branch' ? label(branch) : label(warehouse);
              return (
                <tr key={`${row.type}-${row.branchId}-${row.warehouseId || ''}`}>
                  <td>{row.type}</td>
                  <td>
                    {row.type === 'Branch' ? (
                      <SelectField aria-label={`Branch for row ${index + 1}`} className="ui-select w-full" value={row.branchId} onChange={(e) => changeBranch(row.branchId, e.target.value)}>
                        <option value={row.branchId}>{label(branch)}</option>
                        {availableBranches.map((item) => (
                          <option key={item.id} value={item.id}>{label(item)}</option>
                        ))}
                      </SelectField>
                    ) : (
                      label(branch)
                    )}
                  </td>
                  <td>
                    {row.type === 'Warehouse' ? (
                      <select aria-label={`Warehouse for row ${index + 1}`} className="ui-select w-full" value={row.warehouseId} onChange={(e) => changeWarehouse(row.warehouseId, e.target.value)}>
                        <option value={row.warehouseId}>{label(warehouse)}</option>
                        {availableWarehouses
                          .filter((item) => id(item.branchId) === row.branchId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>{label(item)}</option>
                          ))}
                      </select>
                    ) : (
                      <span className="ui-caption">{warehouses.length ? 'All warehouses' : '—'}</span>
                    )}
                  </td>
                  <td>
                    <select
                      aria-label={`Role at ${place}`}
                      className="ui-select w-full"
                      required={row.type === 'Branch'}
                      value={row.roleId}
                      onChange={(e) => (row.type === 'Branch' ? setBranchRole(row.branchId, e.target.value) : setWarehouseRole(row.warehouseId, e.target.value))}
                    >
                      <option value="">{row.type === 'Branch' ? 'Choose a role' : 'Use branch role'}</option>
                      {roleOptions.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="ws-btn ws-btn--quiet ws-btn--small"
                      aria-label={`Remove ${place}`}
                      onClick={() => (row.type === 'Branch' ? removeBranch(row.branchId) : removeWarehouse(row.warehouseId))}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="ui-caption">Add a branch to give access.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
