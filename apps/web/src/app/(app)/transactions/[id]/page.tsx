'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync, Spinner, Notice, Badge, Modal, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import {
  formatMoney,
  formatRate,
  formatDateTime,
  STATUS_META,
  TYPE_LABELS,
  SEVERITY_META,
  DOC_TYPE_LABELS,
} from '@/lib/format';
import type { Transaction } from '@/lib/types';

export default function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(
    (signal) => api.get<Transaction>(`/transactions/${id}`, signal),
    [id],
  );

  const [action, setAction] = useState<null | 'validate' | 'reject' | 'cancel'>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  if (loading) return <Spinner label="Chargement de l'opération…" />;
  if (error) return <Notice kind="danger">{error}</Notice>;
  if (!data || !user) return null;

  const isPending = data.status === 'EN_ATTENTE';
  const canReview =
    (user.role === 'SUPERVISEUR' || user.role === 'ADMIN') &&
    isPending &&
    data.operator.id !== user.id;
  const ownReview =
    isPending && data.operator.id === user.id && user.role !== 'BCC' && user.role !== 'CABISTE';
  const canCancel = user.role === 'ADMIN' && data.status === 'VALIDEE';
  const canPrint =
    data.status === 'VALIDEE' &&
    data.receipt !== null &&
    (user.role === 'ADMIN' ||
      user.role === 'SUPERVISEUR' ||
      (user.role === 'CABISTE' && data.operator.id === user.id));

  const submitReview = async () => {
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'validate') {
        await api.patch(`/transactions/${id}/validate`, { comment: comment || undefined });
      } else if (action === 'reject') {
        await api.patch(`/transactions/${id}/reject`, { comment });
      } else if (action === 'cancel') {
        await api.patch(`/transactions/${id}/cancel`, { reason: comment });
      }
      setAction(null);
      setComment('');
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec de l'action.");
    } finally {
      setBusy(false);
    }
  };

  const printPdf = async () => {
    setPdfBusy(true);
    setActionError(null);
    try {
      const blob = await api.raw(`/transactions/${id}/receipt/pdf`, 'POST');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // On laisse le temps a l'onglet de charger le blob avant de le liberer.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec de l'impression.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data.reference}
        subtitle={`${TYPE_LABELS[data.type]} — ${formatDateTime(data.occurredAt)}`}
        actions={
          <Link href="/transactions" className="btn btn-ghost">
            ← Retour
          </Link>
        }
      />

      {actionError && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="danger">{actionError}</Notice>
        </div>
      )}

      <div className="row-wrap" style={{ marginBottom: 16 }}>
        <Badge className={STATUS_META[data.status].badge}>{STATUS_META[data.status].label}</Badge>
        {data.client.isPep && <Badge className="badge-warning">Client PPE</Badge>}
        {data.receipt && (
          <span className="small muted">
            Bordereau <span className="mono">{data.receipt.number}</span> — {data.receipt.printCount} impression(s)
          </span>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        {/* Detail operation */}
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Détail de l&apos;opération</h2></div>
            <div className="card-pad">
              <table className="table" style={{ fontSize: '0.92rem' }}>
                <tbody>
                  <Row label="Sens">
                    <Badge className={data.type === 'ACHAT' ? 'badge-accent' : 'badge-neutral'}>
                      {TYPE_LABELS[data.type]}
                    </Badge>
                  </Row>
                  <Row label="Montant remis par le client">
                    <span className="strong">{formatMoney(data.fromAmount, data.fromCurrency)}</span>
                  </Row>
                  <Row label="Taux appliqué">
                    1 {data.fromCurrency === 'CDF' ? data.toCurrency : data.fromCurrency} ={' '}
                    {formatRate(data.appliedRate)} CDF
                  </Row>
                  <Row label="Commission">{formatMoney(data.commission, data.toCurrency)}</Row>
                  <Row label="Montant remis au client">
                    <span className="strong" style={{ color: 'var(--brand-800)', fontSize: '1.05rem' }}>
                      {formatMoney(data.toAmount, data.toCurrency)}
                    </span>
                  </Row>
                  <Row label="Contre-valeur USD">{formatMoney(data.usdEquivalent, 'USD')}</Row>
                </tbody>
              </table>
            </div>
          </div>

          {data.reviewComment && (
            <div className="card card-pad">
              <div className="small muted strong" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Commentaire de contrôle
              </div>
              <div>{data.reviewComment}</div>
              {data.reviewedBy && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  — {data.reviewedBy.fullName}
                </div>
              )}
            </div>
          )}

          {data.alerts && data.alerts.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Alertes ({data.alerts.length})</h2></div>
              <div className="card-pad stack-sm">
                {data.alerts.map((a) => (
                  <div key={a.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <Badge className={SEVERITY_META[a.severity].badge}>{SEVERITY_META[a.severity].label}</Badge>
                    <span className="grow small">{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Colonne laterale : client + actions */}
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Client</h2></div>
            <div className="card-pad stack-sm">
              <div>
                <div className="strong">{data.client.fullName}</div>
                <Link href={`/clients/${data.client.id}`} className="small">
                  Voir la fiche →
                </Link>
              </div>
              <div className="small">
                <span className="muted">Pièce : </span>
                {DOC_TYPE_LABELS[data.client.idDocumentType] ?? data.client.idDocumentType}
              </div>
              <div className="small mono">{data.client.idDocumentNo}</div>
              {data.client.phone && <div className="small muted">{data.client.phone}</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Agence & cabiste</h2></div>
            <div className="card-pad stack-sm small">
              <div><span className="muted">Agence : </span>{data.agency.code} — {data.agency.name}</div>
              <div><span className="muted">Cabiste : </span>{data.operator.fullName}</div>
              <div><span className="muted">Enregistrée : </span>{formatDateTime(data.createdAt)}</div>
            </div>
          </div>

          {/* Actions */}
          {(canReview || ownReview || canCancel || canPrint) && (
            <div className="card card-pad stack-sm">
              {canPrint && (
                <button className="btn btn-primary btn-block" onClick={printPdf} disabled={pdfBusy}>
                  {pdfBusy ? <span className="spinner" /> : '🖶 Imprimer le bordereau'}
                </button>
              )}
              {canReview && (
                <>
                  <button className="btn btn-success btn-block" onClick={() => { setAction('validate'); setComment(''); }}>
                    ✓ Valider l&apos;opération
                  </button>
                  <button className="btn btn-danger btn-block" onClick={() => { setAction('reject'); setComment(''); }}>
                    ✕ Rejeter
                  </button>
                </>
              )}
              {ownReview && (
                <Notice kind="info">
                  En attente de validation par un autre superviseur : vous ne pouvez pas valider
                  votre propre saisie.
                </Notice>
              )}
              {canCancel && (
                <button className="btn btn-ghost btn-block" onClick={() => { setAction('cancel'); setComment(''); }} style={{ color: 'var(--danger-700)' }}>
                  Annuler l&apos;opération
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {action && (
        <Modal
          title={
            action === 'validate'
              ? "Valider l'opération"
              : action === 'reject'
                ? "Rejeter l'opération"
                : "Annuler l'opération"
          }
          onClose={() => setAction(null)}
          footer={
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setAction(null)}>Annuler</button>
              <button
                className={`btn ${action === 'validate' ? 'btn-success' : 'btn-danger'}`}
                onClick={submitReview}
                disabled={busy || (action !== 'validate' && comment.trim().length < 10)}
              >
                {busy ? <span className="spinner" /> : 'Confirmer'}
              </button>
            </div>
          }
        >
          {action === 'validate' && (
            <p className="muted small" style={{ marginTop: 0 }}>
              Le bordereau sera émis et remis au client. Un commentaire est facultatif.
            </p>
          )}
          {action === 'cancel' && (
            <Notice kind="warning">
              Le bordereau a déjà été remis au client. L&apos;opération sera marquée ANNULÉE
              mais restera dans l&apos;historique.
            </Notice>
          )}
          <div style={{ marginTop: 12 }}>
            <Field
              label={action === 'validate' ? 'Commentaire (facultatif)' : 'Motif (obligatoire, min. 10 caractères)'}
            >
              <textarea
                className="textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={action === 'reject' ? 'Ex. : pièce d\'identité illisible, à représenter.' : ''}
              />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="muted" style={{ width: '52%' }}>{label}</td>
      <td className="right">{children}</td>
    </tr>
  );
}
