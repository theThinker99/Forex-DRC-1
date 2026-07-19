'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Spinner, Notice, Badge, EmptyState, Modal, Field, Pagination } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatDateTime } from '@/lib/format';
import { currencyName } from '@/lib/currencies';
import type {
  CashSummary,
  CashSessionListItem,
  Paginated,
  RateBoardEntry,
} from '@/lib/types';

export default function CashPage() {
  const { user } = useAuth();
  const hasOwnTill = user?.role === 'CABISTE' || user?.role === 'SUPERVISEUR';

  const [current, setCurrent] = useState<CashSummary | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const loadCurrent = () => {
    if (!hasOwnTill) {
      setLoadingCurrent(false);
      return;
    }
    setLoadingCurrent(true);
    api
      .get<CashSummary | null>('/cash-sessions/current')
      .then((s) => setCurrent(s))
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur.'))
      .finally(() => setLoadingCurrent(false));
  };

  useEffect(loadCurrent, [hasOwnTill]);

  return (
    <>
      <PageHeader
        title="Caisse"
        subtitle={
          hasOwnTill
            ? 'Ouvrez votre caisse en début de journée, clôturez-la en fin de journée.'
            : 'Suivi des caisses des cabistes.'
        }
        actions={
          hasOwnTill && !current && !loadingCurrent ? (
            <button className="btn btn-accent" onClick={() => setOpening(true)}>
              ＋ Ouvrir ma caisse
            </button>
          ) : undefined
        }
      />

      {error && <div style={{ marginBottom: 16 }}><Notice kind="danger">{error}</Notice></div>}

      {hasOwnTill && (
        <div style={{ marginBottom: 24 }}>
          {loadingCurrent ? (
            <Spinner label="Chargement de votre caisse…" />
          ) : current ? (
            <SummaryCard
              summary={current}
              title="Ma caisse du jour"
              onClose={() => setClosing(true)}
              closable
            />
          ) : (
            <div className="card card-pad">
              <EmptyState
                title="Aucune caisse ouverte"
                hint="Ouvrir votre caisse est facultatif, mais permet de suivre vos fonds par devise et de clôturer proprement en fin de journée."
              />
            </div>
          )}
        </div>
      )}

      <HistoryList key={historyTick} />

      {opening && (
        <OpenTillModal
          onClose={() => setOpening(false)}
          onDone={() => { setOpening(false); loadCurrent(); setHistoryTick((t) => t + 1); }}
        />
      )}
      {closing && current && (
        <CloseTillModal
          summary={current}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); loadCurrent(); setHistoryTick((t) => t + 1); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Résumé d'une caisse (par devise)
// ---------------------------------------------------------------------------

function SummaryCard({
  summary,
  title,
  onClose,
  closable,
}: {
  summary: CashSummary;
  title: string;
  onClose?: () => void;
  closable?: boolean;
}) {
  const s = summary.session;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          <div className="small muted" style={{ marginTop: 2 }}>
            {s.operator.fullName} · {s.agency.code} · ouverte le {formatDateTime(s.openedAt)}
            {' '}· {summary.operations} opération{summary.operations > 1 ? 's' : ''}
          </div>
        </div>
        <div className="row">
          <Badge className={s.status === 'OUVERTE' ? 'badge-success' : 'badge-neutral'}>
            {s.status === 'OUVERTE' ? 'Ouverte' : 'Clôturée'}
          </Badge>
          {closable && s.status === 'OUVERTE' && (
            <button className="btn btn-primary btn-sm" onClick={onClose}>Clôturer</button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Devise</th>
              <th className="num">Fonds d&apos;ouverture</th>
              <th className="num">Entrées</th>
              <th className="num">Sorties</th>
              <th className="num">Solde théorique</th>
              {s.status === 'CLOTUREE' && <th className="num">Compté</th>}
              {s.status === 'CLOTUREE' && <th className="num">Écart</th>}
            </tr>
          </thead>
          <tbody>
            {summary.lines.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="Aucun mouvement" hint="Les opérations du jour apparaîtront ici." />
                </td>
              </tr>
            ) : (
              summary.lines.map((l) => (
                <tr key={l.currency}>
                  <td>
                    <span className="strong">{l.currency}</span>
                    <div className="small muted">{currencyName(l.currency)}</div>
                  </td>
                  <td className="num mono">{formatMoney(l.opening)}</td>
                  <td className="num mono" style={{ color: 'var(--success-700)' }}>+{formatMoney(l.inflow)}</td>
                  <td className="num mono" style={{ color: 'var(--danger-700)' }}>−{formatMoney(l.outflow)}</td>
                  <td className="num mono strong">{formatMoney(l.theoretical)}</td>
                  {s.status === 'CLOTUREE' && (
                    <td className="num mono">{l.counted !== null ? formatMoney(l.counted) : '—'}</td>
                  )}
                  {s.status === 'CLOTUREE' && (
                    <td className="num mono">
                      {l.variance !== null ? <VarianceBadge value={l.variance} /> : '—'}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VarianceBadge({ value }: { value: string }) {
  const n = Number(value);
  if (Math.abs(n) < 0.005) return <Badge className="badge-success">Juste</Badge>;
  return (
    <Badge className={n > 0 ? 'badge-info' : 'badge-danger'}>
      {n > 0 ? '+' : '−'}{formatMoney(Math.abs(n))}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Ouverture
// ---------------------------------------------------------------------------

function OpenTillModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [currencies, setCurrencies] = useState<string[]>(['CDF', 'USD', 'EUR']);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Propose le CDF, l'USD, l'EUR et toute devise ayant un taux publié.
  useEffect(() => {
    api
      .get<RateBoardEntry[]>('/exchange-rates/board')
      .then((board) => {
        const avail = board.filter((b) => b.available).map((b) => b.currency);
        setCurrencies((prev) => Array.from(new Set([...prev, ...avail])));
      })
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    const balances: Record<string, string> = {};
    for (const [cur, val] of Object.entries(amounts)) {
      if (val && Number(val) > 0) balances[cur] = val;
    }
    if (Object.keys(balances).length === 0) {
      setError('Renseignez au moins un montant (le fonds de caisse).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/cash-sessions/open', { balances, note: note || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Ouvrir ma caisse"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Ouvrir la caisse'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <p className="small muted" style={{ marginTop: error ? 12 : 0 }}>
        Saisissez les fonds que vous avez en main, devise par devise. Laissez vide
        celles que vous n&apos;avez pas.
      </p>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        {currencies.map((cur) => (
          <div key={cur} className="row" style={{ gap: 10 }}>
            <div style={{ width: 130 }}>
              <div className="strong">{cur}</div>
              <div className="small muted">{currencyName(cur)}</div>
            </div>
            <input
              className="input grow"
              inputMode="decimal"
              placeholder="0.00"
              value={amounts[cur] ?? ''}
              onChange={(e) => setAmounts({ ...amounts, [cur]: e.target.value.replace(',', '.') })}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Note (facultatif)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------

function CloseTillModal({
  summary,
  onClose,
  onDone,
}: {
  summary: CashSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Écart en direct = compté - théorique, pour chaque devise renseignée.
  const variances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const line of summary.lines) {
      const c = counted[line.currency];
      if (c !== undefined && c !== '') {
        out[line.currency] = Number(c) - Number(line.theoretical);
      }
    }
    return out;
  }, [counted, summary.lines]);

  const submit = async () => {
    const countedBalances: Record<string, string> = {};
    for (const [cur, val] of Object.entries(counted)) {
      if (val !== '') countedBalances[cur] = val;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/cash-sessions/${summary.session.id}/close`, {
        countedBalances: Object.keys(countedBalances).length ? countedBalances : undefined,
        note: note || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Clôturer ma caisse"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Clôturer'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <p className="small muted" style={{ marginTop: error ? 12 : 0 }}>
        Comptez votre caisse et saisissez les montants réels (facultatif) pour
        faire apparaître les écarts. La clôture est définitive.
      </p>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Devise</th>
              <th className="num">Théorique</th>
              <th>Compté</th>
              <th className="num">Écart</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((l) => {
              const v = variances[l.currency];
              return (
                <tr key={l.currency}>
                  <td className="strong">{l.currency}</td>
                  <td className="num mono">{formatMoney(l.theoretical)}</td>
                  <td>
                    <input
                      className="input"
                      inputMode="decimal"
                      style={{ minHeight: 36, minWidth: 110 }}
                      placeholder={l.theoretical}
                      value={counted[l.currency] ?? ''}
                      onChange={(e) => setCounted({ ...counted, [l.currency]: e.target.value.replace(',', '.') })}
                    />
                  </td>
                  <td className="num mono">
                    {v === undefined ? '—' : (
                      <span style={{ color: Math.abs(v) < 0.005 ? 'var(--success-700)' : v > 0 ? 'var(--info-700)' : 'var(--danger-700)' }}>
                        {v > 0 ? '+' : v < 0 ? '−' : ''}{formatMoney(Math.abs(v))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Note de clôture (facultatif)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function HistoryList() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<CashSessionListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CashSummary | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<Paginated<CashSessionListItem>>(`/cash-sessions${toQuery({ page, limit: 10 })}`)
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page]);

  const openDetail = (id: string) => {
    api.get<CashSummary>(`/cash-sessions/${id}`).then(setDetail).catch(() => undefined);
  };

  return (
    <div className="card">
      <div className="card-head"><h2>Historique des caisses</h2></div>
      {loading ? (
        <Spinner />
      ) : data && data.data.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cabiste</th>
                  <th>Agence</th>
                  <th>Ouverture</th>
                  <th>Clôture</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.operator.fullName}</td>
                    <td className="small">{s.agency.code}</td>
                    <td className="small">{formatDateTime(s.openedAt)}</td>
                    <td className="small">{s.closedAt ? formatDateTime(s.closedAt) : '—'}</td>
                    <td>
                      <Badge className={s.status === 'OUVERTE' ? 'badge-success' : 'badge-neutral'}>
                        {s.status === 'OUVERTE' ? 'Ouverte' : 'Clôturée'}
                      </Badge>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => openDetail(s.id)}>Détails</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-pad" style={{ borderTop: '1px solid var(--ink-200)' }}>
            <Pagination meta={data.meta} onPage={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="Aucune caisse enregistrée" />
      )}

      {detail && (
        <Modal title={`Caisse — ${detail.session.operator.fullName}`} onClose={() => setDetail(null)}>
          <SummaryCard summary={detail} title={formatDateTime(detail.session.openedAt)} />
        </Modal>
      )}
    </div>
  );
}
