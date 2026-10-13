import React, { useMemo, useState } from 'react';
import { Plus, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import { confirmDialog } from '@ui/components/ui/notify';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { CustomerForm } from '../../components/pickers/CustomerPicker';
import CustomerDetailPage from './CustomerDetailPage';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { formatMoney } from '@ui/utils/money';
import { isGstRegistered, outstandingByParty, standingOf } from '@ui/utils/partyStanding';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * The customer master.
 *
 * Lifted out of App.jsx when it moved onto the shared list layout: it is a
 * screen in its own right, and a screen that cannot be rendered on its own
 * cannot be tested on its own either.
 */
export default function CustomersList({ db, setDb, currentCompany, onNewTransaction, onEditTransaction }) {
  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);
  const customerSearch = useListSearch(customers, [(c) => getCustomerDisplayName(c), 'phone', 'mobile', 'email', 'gstin']);
  const customerSearchFilters = useColumnFilters();
  const shownCustomers = customerSearchFilters.applyFilters(customerSearch.filtered, {
    name: (r) => getCustomerDisplayName(r),
    phone: (r) => r.mobile || r.phone || '',
    email: (r) => r.email,
    gstReg: (r) => r.gstRegistration,
    gstin: (r) => r.gstin,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [viewingCustomer, setViewingCustomer] = useState(null);

  /*
   * What each customer owes, from the invoices themselves.
   *
   * The list carried a stored `balance` that nothing maintained, so the column
   * read ₹0.00 for every customer while the invoice list showed lakhs against
   * the same names. A customer master is opened to answer "who owes me what".
   */
  const customerStanding = useMemo(
    () => outstandingByParty({ docs: db.invoices || [], idKey: 'customerId', companyId: currentCompany.id }),
    [db.invoices, currentCompany.id]
  );

  const [custStatus, setCustStatus] = useState('');
  const CUST_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Owing', label: 'Owing', tone: 'outstanding' },
    { value: 'Overdue', label: 'Overdue', tone: 'overdue' },
    { value: 'Registered', label: 'GST registered', tone: 'paid' },
    { value: 'Unregistered', label: 'Unregistered', tone: 'draft' },
  ];
  const custMatches = (c, tab) => {
    const st = standingOf(customerStanding, c.id);
    if (tab === 'Owing') return st.outstanding > 0.0001;
    if (tab === 'Overdue') return st.overdue > 0.0001;
    if (tab === 'Registered') return isGstRegistered(c);
    if (tab === 'Unregistered') return !isGstRegistered(c);
    return true;
  };
  const visibleCustomers = custStatus ? shownCustomers.filter((c) => custMatches(c, custStatus)) : shownCustomers;

  const custStatusCounts = useMemo(() => {
    const counts = { '': shownCustomers.length };
    for (const t of CUST_STATUS_TABS) {
      if (!t.value) continue;
      counts[t.value] = shownCustomers.filter((c) => custMatches(c, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownCustomers, customerStanding]);

  const custHeadline = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    let registered = 0;
    let owing = 0;
    for (const c of shownCustomers) {
      const st = standingOf(customerStanding, c.id);
      outstanding += st.outstanding;
      overdue += st.overdue;
      if (st.outstanding > 0.0001) owing += 1;
      if (isGstRegistered(c)) registered += 1;
    }
    return { count: shownCustomers.length, outstanding, overdue, registered, owing };
  }, [shownCustomers, customerStanding]);

  const custExportColumns = [
    { key: 'name', label: 'Name', value: (r) => getCustomerDisplayName(r) },
    { key: 'phone', label: 'Phone', value: (r) => r.mobile || r.phone || '' },
    { key: 'email', label: 'Email' },
    { key: 'gstRegistration', label: 'GST Reg.' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'outstanding', label: 'Outstanding', value: (r) => standingOf(customerStanding, r.id).outstanding },
    { key: 'overdue', label: 'Overdue', value: (r) => standingOf(customerStanding, r.id).overdue },
  ];

  const onEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setIsCreating(false);
  };

  if (viewingCustomer) {
    const liveCustomer = customers.find((customer) => String(customer.id) === String(viewingCustomer.id)) || viewingCustomer;
    const deleteCustomerTransaction = async (row) => {
      const ok = await confirmDialog({ title: 'Delete transaction?', message: `Delete ${row.type} ${row.number || ''}? This removes it from this customer statement.`, confirmLabel: 'Delete', tone: 'danger' });
      if (!ok) return;
      if (row.type === 'Opening Balance') {
        setDb({ ...db, customers: (db.customers || []).map((item) => String(item.id) === String(liveCustomer.id) ? { ...item, openingBalance: 0 } : item) });
        return;
      }
      const collection = row.type === 'Sales' ? 'invoices' : row.type === 'Receipt' ? 'payments' : row.type === 'CN' ? 'creditNotes' : row.type === 'Debit Note' ? 'debitNotes' : row.type === 'Sales Return' ? 'salesReturns' : '';
      if (!collection) return;
      setDb({ ...db, [collection]: (db[collection] || []).filter((item) => String(item.id) !== String(row.raw?.id)) });
    };
    return (
      <CustomerDetailPage
        db={db}
        currentCompany={currentCompany}
        customer={liveCustomer}
        onEditTransaction={(row) => {
          if (row.type === 'Opening Balance') {
            setViewingCustomer(null);
            onEditCustomer(liveCustomer);
            return;
          }
          onEditTransaction?.(row);
        }}
        onDeleteTransaction={deleteCustomerTransaction}
        onNewTransaction={() => onNewTransaction?.(liveCustomer)}
        onBack={() => setViewingCustomer(null)}
        onEdit={() => {
          const c = liveCustomer;
          setViewingCustomer(null);
          onEditCustomer(c);
        }}
      />
    );
  }

  /*
   * The form carries its own header — the name on the left, Back, Cancel, Save
   * and the ⋮ on the right, which is what the master asks for. This screen used
   * to print a second heading and a second Back above the card.
   */
  if (isCreating) {
    const seed = isCreating === true ? null : isCreating;
    return (
      <div className="space-y-6">
        <CustomerForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          seedData={seed}
          onClose={() => setIsCreating(false)}
        />
      </div>
    );
  }

  if (editingCustomer) {
    return (
      <div className="space-y-6">
        <CustomerForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onDuplicate={(values) => {
            setEditingCustomer(null);
            setIsCreating(values);
          }}
        />
      </div>
    );
  }


  return (
    <DocumentListShell
      entity="customers"
      title="Customers"
      compact
      tight
      className="customer-list-page"
      company={currentCompany}
      search={{
        value: customerSearch.query,
        onChange: customerSearch.setQuery,
        placeholder: 'Search customers…',
        label: 'Search customers',
      }}
      moreItems={[exportMenuItem('Export customers')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Customers',
          fileName: `Customers_${currentCompany?.name || 'company'}`,
          label: 'customer(s)',
          columns: custExportColumns,
          rows: visibleCustomers,
        });
      }}
      primary={
        <button type="button" onClick={() => setIsCreating(true)} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Customer
        </button>
      }
      tabs={CUST_STATUS_TABS}
      tabsLabel="Customer filter"
      statusInHeader
      statusValue={custStatus}
      statusCounts={custStatusCounts}
      onStatusChange={setCustStatus}
    >
      <div
        className="overflow-x-auto ui-table-scroll customer-table-scroll"
      >
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              <ColumnHeader label="Name" col="name" state={customerSearchFilters} />
              <ColumnHeader label="Phone" col="phone" state={customerSearchFilters} />
              <ColumnHeader label="Email" col="email" state={customerSearchFilters} />
              <ColumnHeader label="GST Reg." col="gstReg" state={customerSearchFilters} />
              <ColumnHeader label="GSTIN" col="gstin" state={customerSearchFilters} />
              <th scope="col" className="ui-num">Outstanding</th>
              {/* Overdue beside outstanding, not instead of it: the second
                  figure is the one somebody rings about. */}
              <th scope="col" className="ui-num">Overdue</th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {visibleCustomers.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <EmptyState
                    icon={Users}
                    kind="new"
      title={custStatus ? 'No customers match' : 'No customers yet'}
                    description={
                      custStatus
                        ? 'Nothing in this company matches that filter.'
                        : 'A customer is who an invoice is addressed to — their GSTIN decides how the tax on it is split.'
                    }
                    routes={
                      custStatus
                        ? undefined
                        : [
                            {
                              label: 'Add one now',
                              description: 'Name, GSTIN, where to send the invoice.',
                              onSelect: () => setIsCreating(true),
                            },
                            {
                              label: 'Import your list',
                              description: 'Bring across the customers you already have.',
                              onSelect: () => setIsCreating(true),
                            },
                          ]
                    }
                  />
                </td>
              </tr>
            ) : (
              visibleCustomers.map((customer) => (
                <tr
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if (e.target?.closest?.('button')) return;
                    setViewingCustomer(customer);
                  }}
                >
                  <td className="ui-col-entity truncate" title={getCustomerDisplayName(customer)}>
                    {getCustomerDisplayName(customer)}
                  </td>
                  <td className="ui-col-meta truncate" title={customer.mobile || customer.phone || ''}>
                    {customer.mobile || customer.phone || '-'}
                  </td>
                  <td className="ui-col-meta truncate" title={customer.email || ''}>
                    {customer.email || '-'}
                  </td>
                  <td className="ui-col-meta">{customer.gstRegistration || 'Unregistered'}</td>
                  <td className="ui-col-meta truncate" title={customer.gstin || ''}>
                    {customer.gstin || '-'}
                  </td>
                  <td className="ui-col-amount">
                    {formatMoney(standingOf(customerStanding, customer.id).outstanding, currentCompany)}
                  </td>
                  <td className="ui-col-amount">
                    {standingOf(customerStanding, customer.id).overdue > 0.0001 ? (
                      <span className="ui-amount-neg">
                        {formatMoney(standingOf(customerStanding, customer.id).overdue, currentCompany)}
                      </span>
                    ) : (
                      <span className="ui-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TableTotals
        count={visibleCustomers.length}
        totalCount={customers.length}
        noun="customers"
        figures={[{ label: 'Outstanding', value: formatMoney(custHeadline.outstanding, currentCompany) }]}
      />
    </DocumentListShell>
  );
}
