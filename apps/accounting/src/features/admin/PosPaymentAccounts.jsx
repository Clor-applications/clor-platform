import React, { useCallback, useEffect, useState } from 'react';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getPosTenderAccounts, setPosTenderAccount, clearPosTenderAccount } from '../../api/posTenderAccounts';
import SettingsScreenHeader from '../settings/SettingsScreenHeader';

/**
 * Where the counter's money goes.
 *
 * A till knows it took cash; the books need an account. Until this is set the
 * point of sale has nowhere honest to record what it took, so the tender simply
 * cannot be accepted — which is the right answer, and better than guessing at
 * an account and discovering the mistake at a bank reconciliation.
 *
 * Per branch, deliberately. The accounts belong to a counter, and the branch in
 * context at the top of the screen is the one being configured. Nothing is
 * inherited from anywhere and nothing is chosen by default: a business says
 * where its money lands, or it does not take that tender.
 */

/*
 * `spoken` is the tender inside a sentence, and it is not the label lowercased:
 * UPI is an abbreviation and stays in capitals, so `label.toLowerCase()` read
 * "the counter cannot take upi".
 */
const TENDERS = [
  { key: 'CASH', label: 'Cash', spoken: 'cash', needs: 'a cash account' },
  { key: 'UPI', label: 'UPI', spoken: 'UPI', needs: 'a bank account' },
  { key: 'CARD', label: 'Card', spoken: 'card', needs: 'a bank account' },
];

export default function PosPaymentAccounts({ currentCompany = null, branchLabel = '' }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [tenders, setTenders] = useState({});
  const [accounts, setAccounts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getPosTenderAccounts();
      setTenders(data.tenders);
      setAccounts(data.eligibleAccounts);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  /* Reloads when the branch in context changes: this screen shows one branch's
     accounts, and showing another's would be worse than showing none. */
  useEffect(() => {
    load();
  }, [load, currentCompany?.id, branchLabel]);

  const choose = async (tender, ledgerAccountId) => {
    setSaving(tender);
    try {
      const next = ledgerAccountId
        ? await setPosTenderAccount({ tender, ledgerAccountId })
        : await clearPosTenderAccount(tender);
      setTenders(next);
    } catch (e) {
      notify.error(String(e?.message || 'Could not save that account.'));
    } finally {
      setSaving('');
    }
  };

  if (loading) return <SkeletonCard lines={4} />;

  return (
    <div className="space-y-3">
      <SettingsScreenHeader
        entity="settings"
        title="POS payment accounts"
        description={
          branchLabel
            ? `Where ${branchLabel} posts the money it takes at the counter.`
            : 'Where this branch posts the money it takes at the counter.'
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      <section className="ui-card overflow-hidden">
        {TENDERS.map(({ key, label, spoken, needs }) => {
          const current = tenders[key] || { status: 'UNCONFIGURED', controlKind: key === 'CASH' ? 'CASH' : 'BANK' };
          const options = accounts.filter((a) => a.controlKind === current.controlKind);
          const configured = current.status === 'DIRECT';

          return (
            <div key={key} className="ui-feature-row">
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium">{label}</span>
                {!configured ? (
                  <span className="ui-caption block mt-0.5">
                    Not configured — the counter cannot take {spoken} until it has {needs}.
                  </span>
                ) : null}
              </span>

              <select
                className="ui-select"
                style={{ width: '18rem' }}
                aria-label={`${label} account`}
                disabled={saving === key}
                value={configured ? current.ledgerAccountId : ''}
                onChange={(e) => choose(key, e.target.value)}
              >
                {/* No account is selected until somebody selects one. */}
                <option value="">Not configured</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.shared ? ' · shared' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </section>

      {!accounts.length ? (
        <p className="ui-subtle text-xs">
          No cash or bank accounts have been opened yet. Add one under Chart of Accounts, then choose it here.
        </p>
      ) : (
        <p className="ui-subtle text-xs">
          Each branch keeps its own accounts. An account marked shared belongs to the whole organisation; choosing it
          here is still this branch&rsquo;s choice.
        </p>
      )}
    </div>
  );
}
