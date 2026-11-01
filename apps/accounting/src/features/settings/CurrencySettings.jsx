import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { createCurrency, listCurrencies } from '../../api/currencies';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { CURRENCY_CATALOG, currencyMeta } from '@ui/utils/currencyCatalog';
import { CURRENCIES_CHANGED_EVENT } from '../../hooks/useEnabledCurrencies';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';

export default function CurrencySettings() {
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [query, setQuery] = useState('');

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

  const available = useMemo(() => CURRENCY_CATALOG.filter(
    (entry) => entry.code !== baseCurrency && !currencies.some((currency) => currency.code === entry.code)
  ), [baseCurrency, currencies]);

  const enableCurrency = async (event) => {
    event.preventDefault();
    const selected = currencyMeta(draftCode);
    if (!selected) return;
    setBusy(true);
    try {
      await createCurrency({ code: selected.code, name: selected.name, symbol: selected.symbol });
      setDraftCode('');
      await reload();
      window.dispatchEvent(new Event(CURRENCIES_CHANGED_EVENT));
    } catch (e) {
      setError(String(e?.message || 'Could not enable currency.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SkeletonCard lines={6} />;
  const shown = currencies.filter((currency) =>
    `${currency.code} ${currency.name}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Framed in Settings the header gives way to the frame's title, so the
          base-currency rule is printed here where it is always seen. */}
      <SettingsScreenHeader entity="currency" title="Currencies" />
      <p className="ui-muted ui-t-body">{`The books are kept in ${baseCurrency}. Enable the foreign currencies this company uses.`}</p>
      {error ? <div className="ui-card px-3 py-2 text-sm text-[rgb(var(--neg))]" role="alert">{error}</div> : null}
      <form onSubmit={enableCurrency} className="ui-card p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[18rem] flex-1">
          <label className="ui-label">Enable currency</label>
          <PopupSelect ariaLabel="Enable currency" title="Select Currency" value={draftCode} onChange={setDraftCode} options={available} placeholder="Search currency by code or name" alwaysSearch />
        </div>
        <button type="submit" disabled={busy || !draftCode} className="ui-btn ui-btn-primary disabled:opacity-50">
          <Plus size={16} /> {busy ? 'Enabling…' : 'Enable currency'}
        </button>
      </form>
      <section className="ui-card overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'rgb(var(--border))' }}>
          <Search size={15} className="ui-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="ui-input h-8 min-h-8 flex-1 border-0" placeholder="Search enabled currencies" aria-label="Search enabled currencies" />
          <span className="ui-caption">{currencies.length} enabled</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3">
          {shown.length ? shown.map((currency) => (
            <div key={currency.id} className="flex h-11 items-center gap-3 border-b px-3 md:border-r" style={{ borderColor: 'rgb(var(--border))' }}>
              <span className="w-10 font-medium">{currency.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{currency.name}</span>
              <span className="ui-muted">{currency.symbol || '—'}</span>
              <span className="ui-pill ui-pill-pos">Enabled</span>
            </div>
          )) : <div className="p-6 text-center text-sm ui-muted md:col-span-2 xl:col-span-3">No enabled currency matches this search.</div>}
        </div>
      </section>
    </div>
  );
}
