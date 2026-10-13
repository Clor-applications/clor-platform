import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCurrencies } from '../api/currencies';
import { useFeatures } from '@ui/permissions/useFeatures';
import { currencyMeta } from '@ui/utils/currencyCatalog';

export const CURRENCIES_CHANGED_EVENT = 'clor:currencies-changed';

export default function useEnabledCurrencies(company = null) {
  const { isEnabled } = useFeatures();
  const multiCurrency = isEnabled('multiCurrency');
  const fallbackBase = String(company?.currency || company?.baseCurrency || 'INR').toUpperCase();
  const [baseCurrency, setBaseCurrency] = useState(fallbackBase);
  const [enabled, setEnabled] = useState([]);

  const reload = useCallback(() => {
    // Through a promise so a synchronous throw (no active company yet) lands in
    // the catch below instead of crashing the effect, and so no state is set
    // synchronously inside it.
    const load = multiCurrency ? listCurrencies : () => ({ baseCurrency: fallbackBase, currencies: [] });
    Promise.resolve().then(load).then((data) => {
      setBaseCurrency(String(data?.baseCurrency || fallbackBase).toUpperCase());
      setEnabled(Array.isArray(data?.currencies) ? data.currencies : []);
    }).catch(() => {
      setBaseCurrency(fallbackBase);
      setEnabled([]);
    });
  }, [multiCurrency, fallbackBase]);

  useEffect(() => {
    reload();
    window.addEventListener(CURRENCIES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CURRENCIES_CHANGED_EVENT, reload);
  }, [reload]);

  const options = useMemo(() => {
    const all = [{ code: baseCurrency, name: currencyMeta(baseCurrency)?.name || baseCurrency }, ...enabled];
    const unique = new Map();
    for (const row of all) {
      const code = String(row?.code || '').toUpperCase();
      if (!code || unique.has(code)) continue;
      unique.set(code, { value: code, code, label: `${code} - ${row.name || currencyMeta(code)?.name || code}`, searchText: row.name || code });
    }
    return [...unique.values()];
  }, [baseCurrency, enabled]);

  return { baseCurrency, enabled, options, multiCurrency, reload };
}
