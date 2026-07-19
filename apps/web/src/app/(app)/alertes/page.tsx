'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Spinner, Notice, Badge, EmptyState, Pagination, Modal, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatDateTime, SEVERITY_META } from '@/lib/format';
import type { Paginated, Alert, AlertStatus, AlertSeverity } from '@/lib/types';

const STATUS_LABELS: Record<AlertStatus, string> = {
  OUVERTE: 'Ouverte',
  EN_REVUE: 'En revue',
  RESOLUE: 'Résolue',
  IGNOREE: 'Ignorée',
};

export default function AlertsPage() {
  const { user } = useAuth();
  const canResolve = user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR';

  const [status, setStatus] = useState<'' | AlertStatus>('OUVERTE');
  const [severity, setSeverity] = useState<'' | AlertSeverity>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Alert> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resolving, setResolving] = useState<Alert | null>(null);

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<Paginated<Alert>>(`/alerts${toQuery({ status, severity, page, limit: 20 })}`, controller.signal)
      .then(setData)
      .catch((err) => !controller.signal.aborted && setError(err instanceof Error ? err.message : 'Erreur.'))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  };

  useEffect(load, [status, severity, page]);

  return (
    <>
      <PageHeader
        title="Alertes de conformité"
        subtitle="Seuils, fractionnement, taux hors bande, PPE."
      />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap">
          <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as AlertStatus | ''); }}>
            <option value="">Tous les statuts</option>
            {(Object.keys(STATUS_LABELS) as AlertStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select className="select" style={{ maxWidth: 200 }} value={severity} onChange={(e) => { setPage(1); setSeverity(e.target.value as AlertSeverity | ''); }}>
            <option value="">Toutes gravités</option>
            {(['CRITIQUE', 'HAUTE', 'MOYENNE', 'INFO'] as AlertSeverity[]).map((s) => (
              <option key={s} value={s}>{SEVERITY_META[s].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="card-pad"><Notice kind="danger">{error}</Notice></div>
        ) : data && data.data.length > 0 ? (
          <>
            <div className="stack-sm" style={{ padding: 12 }}>
              {data.data.map((a) => (
                <div key={a.id} className="card card-pad" style={{ boxShadow: 'none', borderColor: a.severity === 'CRITIQUE' ? 'var(--danger-600)' : 'var(--ink-200)' }}>
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="grow">
                      <div className="row-wrap" style={{ marginBottom: 6 }}>
                        <Badge className={SEVERITY_META[a.severity].badge}>{SEVERITY_META[a.severity].label}</Badge>
                        <Badge className={a.status === 'OUVERTE' ? 'badge-warning' : a.status === 'RESOLUE' ? 'badge-success' : 'badge-neutral'}>
                          {STATUS_LABELS[a.status]}
                        </Badge>
                        <span className="small muted">{formatDateTime(a.createdAt)}</span>
                      </div>
                      <div>{a.message}</div>
                      <div className="small muted" style={{ marginTop: 6 }}>
                        {a.transaction && (
                          <>
                            <Link href={`/transactions/${a.transaction.id}`} className="mono">{a.transaction.reference}</Link>
                            {' · '}{formatMoney(a.transaction.usdEquivalent, 'USD')}
                            {' · '}{a.transaction.agency.code}
                            {' · '}{a.transaction.operator.fullName}
                          </>
                        )}
                        {a.client && <> · Client : {a.client.fullName}</>}
                      </div>
                      {a.resolution && (
                        <div className="small" style={{ marginTop: 8, padding: 8, background: 'var(--ink-050)', borderRadius: 6 }}>
                          <span className="muted">Résolution : </span>{a.resolution}
                          {a.resolvedBy && <span className="muted"> — {a.resolvedBy.fullName}</span>}
                        </div>
                      )}
                    </div>
                    {canResolve && (a.status === 'OUVERTE' || a.status === 'EN_REVUE') && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setResolving(a)}>Traiter</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--ink-200)' }}>
              <Pagination meta={data.meta} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState title="Aucune alerte" hint="Rien à signaler pour ces filtres." />
        )}
      </div>

      {resolving && (
        <ResolveModal
          alert={resolving}
          onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); load(); }}
        />
      )}
    </>
  );
}

function ResolveModal({ alert, onClose, onDone }: { alert: Alert; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<AlertStatus>('RESOLUE');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/alerts/${alert.id}/resolve`, { status, resolution });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Traiter l'alerte"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || resolution.trim().length < 10}>
            {busy ? <span className="spinner" /> : 'Enregistrer'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="stack" style={{ marginTop: error ? 12 : 0 }}>
        <Field label="Décision">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as AlertStatus)}>
            <option value="EN_REVUE">Prise en charge (en revue)</option>
            <option value="RESOLUE">Résolue</option>
            <option value="IGNOREE">Ignorer (faux positif)</option>
          </select>
        </Field>
        <Field label="Explication (min. 10 caractères)" required>
          <textarea className="textarea" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Justification consignée pour le contrôle." />
        </Field>
      </div>
    </Modal>
  );
}
