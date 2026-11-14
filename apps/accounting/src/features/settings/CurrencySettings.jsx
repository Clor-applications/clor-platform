import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Coins, Plus, Power, Search } from 'lucide-react';

import { createCurrency, listCurrencies, updateCurrencyStatus } from '../../api/currencies';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import Drawer from '@ui/components/ui/Drawer';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { CURRENCIES_CHANGED_EVENT } from '../../hooks/useEnabledCurrencies';
import { CURRENCY_CATALOG, currencyMeta } from '@ui/utils/currencyCatalog';

export default function CurrencySettings() {
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [query, setQuery] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');

  const reload = useCallback(async () => {
    try {
      const data = await listCurrencies();
      setBaseCurrency(String(data?.baseCurrency || 'INR'));
      setCurrencies(Array.isArray(data?.currencies) ? data.currencies : []);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load currencies.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const existingByCode = useMemo(() => new Map(
    currencies.map((currency) => [String(currency.code || '').toUpperCase(), currency])
  ), [currencies]);

  const catalogRows = useMemo(() => {
    const normalizedQuery = catalogQuery.trim().toLowerCase();
    return CURRENCY_CATALOG.filter((entry) => {
      if (!normalizedQuery) return true;
      return `${entry.code} ${entry.name} ${entry.symbol}`.toLowerCase().includes(normalizedQuery);
    });
  }, [catalogQuery]);

  const shown = useMemo(() => {
    const baseMeta = currencyMeta(baseCurrency) || { code: baseCurrency, name: baseCurrency, symbol: baseCurrency };
    const baseRow = { ...baseMeta, id: `base-${baseCurrency}`, isBaseCurrency: true, isActive: true };
    const rows = [baseRow, ...currencies.filter((currency) => String(currency.code).toUpperCase() !== baseCurrency)];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return rows;
    return rows.filter((currency) =>
      `${currency.code} ${currency.name} ${currency.symbol || ''}`.toLowerCase().includes(normalizedQuery)
    );
  }, [baseCurrency, currencies, query]);

  const closeDrawer = () => {
    if (busy) return;
    setDrawerOpen(false);
    setDraftCode('');
    setCatalogQuery('');
  };

  const enableCurrency = async (event) => {
    event.preventDefault();
    const selected = currencyMeta(draftCode);
    if (!selected) return;
    setBusy(true);
    try {
      await createCurrency({ code: selected.code, name: selected.name, symbol: selected.symbol });
      await reload();
      window.dispatchEvent(new Event(CURRENCIES_CHANGED_EVENT));
      setDrawerOpen(false);
      setDraftCode('');
      setCatalogQuery('');
    } catch (e) {
      setError(String(e?.message || 'Could not add currency.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleCurrency = async (currency) => {
    const nextActive = currency.isActive === false;
    setBusyId(currency.id);
    setError('');
    try {
      await updateCurrencyStatus(currency.id, nextActive);
      await reload();
      window.dispatchEvent(new Event(CURRENCIES_CHANGED_EVENT));
    } catch (e) {
      setError(String(e?.message || `Could not ${nextActive ? 'enable' : 'disable'} currency.`));
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <>
      <DocumentListShell
        entity="currency"
        title="Currencies"
        compact
        tight
        className="currency-list-page"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search currencies…',
          label: 'Search currencies',
        }}
        primary={(
          <button type="button" onClick={() => setDrawerOpen(true)} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add Currency
          </button>
        )}
        above={error ? <div className="ui-card px-3 py-2 text-sm text-[rgb(var(--neg))]" role="alert">{error}</div> : null}
      >
        <div className="ui-table-scroll currency-table-scroll">
          <table className="ui-table ui-table-sticky w-full table-fixed">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Currency</th>
                <th scope="col">Symbol</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Action</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {shown.length ? shown.map((currency) => (
                <tr key={currency.id || currency.code}>
                  <td className="font-medium">{currency.code}</td>
                  <td>{currency.name}</td>
                  <td>{currency.symbol || '—'}</td>
                  <td>
                    <span className={`ui-pill ${currency.isBaseCurrency ? 'ui-pill-neutral' : currency.isActive === false ? 'ui-pill-neutral' : 'ui-pill-pos'}`}>
                      {currency.isBaseCurrency ? 'Default' : currency.isActive === false ? 'Disabled' : 'Enabled'}
                    </span>
                  </td>
                  <td className="text-right">
                    {currency.isBaseCurrency ? <span className="ui-muted text-sm">Company currency</span> : <button
                      type="button"
                      onClick={() => toggleCurrency(currency)}
                      disabled={busyId === currency.id}
                      className="ui-btn ui-btn-secondary ui-btn-sm"
                    >
                      <Power size={14} aria-hidden="true" />
                      {busyId === currency.id ? 'Saving…' : currency.isActive === false ? 'Enable' : 'Disable'}
                    </button>}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="5">
                    <EmptyState
                      icon={Coins}
                      kind="new"
                      title={query ? 'No currencies match' : 'No foreign currencies yet'}
                      description={query
                        ? 'Try another code, currency name, or symbol.'
                        : `Your books remain in ${baseCurrency}. Add a currency when you need to create foreign-currency transactions.`}
                      routes={query ? undefined : [{ label: 'Add currency', description: 'Choose from the supported currency list.', onSelect: () => setDrawerOpen(true) }]}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DocumentListShell>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title="Add Currency"
        description={`Enable a foreign currency for this company. The company currency is ${baseCurrency}.`}
        widthClass="w-[min(32rem,92vw)]"
        actions={(
          <>
            <button type="button" onClick={closeDrawer} disabled={busy} className="ui-btn ui-btn-secondary">Cancel</button>
            <button
              type="submit"
              form="add-currency-form"
              disabled={busy || !draftCode || existingByCode.has(draftCode)}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add'}
        </button>
          </>
        )}
      >
        <form id="add-currency-form" onSubmit={enableCurrency} className="flex h-full min-h-0 flex-col gap-3">
          <div className="relative shrink-0">
            <Search size={15} className="ui-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              className="ui-input w-full pl-9"
              placeholder="Search all currencies…"
              aria-label="Search all currencies"
              autoFocus
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border ui-border-c" role="listbox" aria-label="Available currencies">
            {catalogRows.map((currency) => {
              const existing = existingByCode.get(currency.code);
              const isBaseCurrency = currency.code === baseCurrency;
              const unavailable = Boolean(existing) || isBaseCurrency;
              const selected = draftCode === currency.code;
              return (
                <button
                  key={currency.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={unavailable}
                  onClick={() => setDraftCode(currency.code)}
                  className="flex min-h-11 w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 disabled:cursor-default"
                  style={{
                    borderColor: 'rgb(var(--border))',
                    backgroundColor: selected ? 'rgb(var(--brand) / 0.10)' : undefined,
                  }}
                >
                  <span className="w-12 shrink-0 text-sm font-medium">{currency.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{currency.name}</span>
                  <span className="w-10 text-center text-sm ui-muted">{currency.symbol}</span>
                  {isBaseCurrency ? <span className="ui-pill">Company</span> : null}
                  {existing ? (
                    <span className={`ui-pill ${existing.isActive === false ? 'ui-pill-neutral' : 'ui-pill-pos'}`}>
                      {existing.isActive === false ? 'Disabled' : 'Enabled'}
                    </span>
                  ) : selected ? <Check size={16} className="text-[rgb(var(--brand))]" aria-hidden="true" /> : <span className="w-4" />}
                </button>
              );
            })}
            {!catalogRows.length ? <div className="p-8 text-center text-sm ui-muted">No currencies match this search.</div> : null}
          </div>
          <p className="shrink-0 text-xs ui-muted">
            Select a currency and choose Add. Conversion rates are entered on individual transactions.
          </p>
      </form>
      </Drawer>
    </>
  );
}
