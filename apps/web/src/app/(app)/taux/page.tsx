'use client';

import { useState } from 'react';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync, Spinner, Notice, Badge, EmptyState, Modal, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatRate, formatDateTime } from '@/lib/format';
import { FOREIGN_CURRENCIES, currencyName, currencyLabel } from '@/lib/currencies';
import type { RateBoardEntry, Paginated, ExchangeRate, Currency } from '@/lib/types';

export default function RatesPage() {
  const { user } = useAuth();
  // Tous les operateurs peuvent publier un taux ; la BCC (lecture seule) non.
  const canPublish =
    user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR' || user?.role === 'CABISTE';

  const board = useAsync((s) => api.get<RateBoardEntry[]>('/exchange-rates/board', s), []);
  const history = useAsync(
    (s) => api.get<Paginated<ExchangeRate>>(`/exchange-rates${toQuery({ limit: 15 })}`, s),
    [],
  );
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Taux de change"
        subtitle={
          user?.agency
            ? `Taux en vigueur pour ${user.agency.name} et taux nationaux.`
            : 'Taux en vigueur et historique.'
        }
        actions={
          canPublish && (
            <button className="btn btn-accent" onClick={() => setCreating(true)}>＋ Publier un taux</button>
          )
        }
      />

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        {board.loading ? (
          <Spinner />
        ) : (
          board.data?.map((entry) => (
            <div key={entry.currency} className="card card-pad">
              <div className="between">
                <div className="row">
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-800)', color: 'white', display: 'grid', placeItems: 'center', fontWeight: 800 }}>
                    {entry.currency}
                  </div>
                  <div>
                    <div className="strong">{entry.currency} / CDF</div>
                    <div className="small muted">{currencyName(entry.currency)}</div>
                    {entry.rate && (
                      <Badge className={entry.rate.scope === 'agence' ? 'badge-accent' : 'badge-neutral'}>
                        {entry.rate.scope === 'agence' ? 'Taux agence' : 'National'}
                      </Badge>
                    )}
                  </div>
                </div>
                {!entry.available && <Badge className="badge-warning">Non défini</Badge>}
              </div>
              {entry.rate && (
                <div className="grid grid-2" style={{ marginTop: 14 }}>
                  <div>
                    <div className="small muted">Achat</div>
                    <div className="strong mono" style={{ fontSize: '1.15rem' }}>{formatMoney(entry.rate.buyRate)}</div>
                  </div>
                  <div>
                    <div className="small muted">Vente</div>
                    <div className="strong mono" style={{ fontSize: '1.15rem' }}>{formatMoney(entry.rate.sellRate)}</div>
                  </div>
                  {entry.rate.referenceRate && (
                    <div>
                      <div className="small muted">Référence BCC</div>
                      <div className="mono">{formatMoney(entry.rate.referenceRate)}</div>
                    </div>
                  )}
                  <div>
                    <div className="small muted">En vigueur depuis</div>
                    <div className="small">{formatDateTime(entry.rate.effectiveFrom)}</div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Historique des taux</h2></div>
        {history.loading ? (
          <Spinner />
        ) : history.data && history.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Paire</th>
                  <th className="num">Achat</th>
                  <th className="num">Vente</th>
                  <th className="num">Réf. BCC</th>
                  <th>Portée</th>
                  <th>Effet</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {history.data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">{r.baseCurrency}/{r.quoteCurrency}</td>
                    <td className="num mono">{formatRate(r.buyRate)}</td>
                    <td className="num mono">{formatRate(r.sellRate)}</td>
                    <td className="num mono">{r.referenceRate ? formatRate(r.referenceRate) : '—'}</td>
                    <td className="small">{r.agency ? r.agency.code : 'National'}</td>
                    <td className="small">{formatDateTime(r.effectiveFrom)}</td>
                    <td>
                      {r.effectiveTo ? (
                        <Badge className="badge-neutral">Clôturé</Badge>
                      ) : (
                        <Badge className="badge-success">En vigueur</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Aucun taux" />
        )}
      </div>

      {creating && (
        <CreateRateModal
          scopeLabel={user?.agency ? user.agency.name : 'National (toutes agences)'}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); board.reload(); history.reload(); }}
        />
      )}
    </>
  );
}

function CreateRateModal({
  scopeLabel,
  onClose,
  onDone,
}: {
  scopeLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [baseCurrency, setBaseCurrency] = useState<Currency>('USD');
  const [buyRate, setBuyRate] = useState('');
  const [sellRate, setSellRate] = useState('');
  const [referenceRate, setReferenceRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/exchange-rates', {
        baseCurrency,
        quoteCurrency: 'CDF',
        buyRate,
        sellRate,
        referenceRate: referenceRate || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Publier un nouveau taux"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy || !buyRate || !sellRate}>
            {busy ? <span className="spinner" /> : 'Publier'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="stack" style={{ marginTop: error ? 12 : 0 }}>
        <Notice kind="info">
          Portée : <strong>{scopeLabel}</strong>. Le taux précédent de la même paire
          sera automatiquement clôturé.
        </Notice>
        <Field label="Devise" required hint={`1 ${currencyName(baseCurrency)} exprimé en francs congolais.`}>
          <select className="select" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value as Currency)}>
            {FOREIGN_CURRENCIES.map((c) => (
              <option key={c} value={c}>{currencyLabel(c)} / CDF</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-2">
          <Field label="Taux d'achat (CDF)" required hint="Prix auquel le bureau achète 1 devise.">
            <input className="input" inputMode="decimal" value={buyRate} onChange={(e) => setBuyRate(e.target.value.replace(',', '.'))} placeholder="2750" />
          </Field>
          <Field label="Taux de vente (CDF)" required hint="Doit être supérieur à l'achat.">
            <input className="input" inputMode="decimal" value={sellRate} onChange={(e) => setSellRate(e.target.value.replace(',', '.'))} placeholder="2800" />
          </Field>
        </div>
        <Field label="Taux de référence BCC (facultatif)" hint="Sert à contrôler l'écart toléré.">
          <input className="input" inputMode="decimal" value={referenceRate} onChange={(e) => setReferenceRate(e.target.value.replace(',', '.'))} placeholder="2775" />
        </Field>
      </div>
    </Modal>
  );
}
