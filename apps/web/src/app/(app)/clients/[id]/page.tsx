'use client';

import { use } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync, Spinner, Notice, Badge, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatDate, formatBytes, DOC_TYPE_LABELS } from '@/lib/format';
import type { Client } from '@/lib/types';

interface ClientDetail extends Client {
  attachments?: Array<{
    id: string;
    kind: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const { data, loading, error } = useAsync(
    (signal) => api.get<ClientDetail>(`/clients/${id}`, signal),
    [id],
  );

  const canOperate =
    user?.role === 'CABISTE' || user?.role === 'SUPERVISEUR' || user?.role === 'ADMIN';

  if (loading) return <Spinner label="Chargement de la fiche…" />;
  if (error) return <Notice kind="danger">{error}</Notice>;
  if (!data) return null;

  const viewFile = async (attId: string) => {
    const blob = await api.raw(`/attachments/${attId}/content`);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <>
      <PageHeader
        title={data.fullName}
        subtitle={`${DOC_TYPE_LABELS[data.idDocumentType]} · ${data.idDocumentNo}`}
        actions={
          <>
            <Link href="/clients" className="btn btn-ghost">← Retour</Link>
            {canOperate && (
              <Link href={`/transactions/nouvelle?clientId=${data.id}`} className="btn btn-accent">
                ＋ Nouvelle opération
              </Link>
            )}
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Informations</h2></div>
          <div className="card-pad">
            <table className="table">
              <tbody>
                <Info label="Nom complet">{data.fullName}</Info>
                <Info label="Type de pièce">{DOC_TYPE_LABELS[data.idDocumentType]}</Info>
                <Info label="Numéro de pièce"><span className="mono">{data.idDocumentNo}</span></Info>
                <Info label="Nationalité">{data.nationality}</Info>
                <Info label="Téléphone">{data.phone ?? '—'}</Info>
                <Info label="Adresse">{data.address ?? '—'}</Info>
                <Info label="Profil">
                  {data.isPep ? <Badge className="badge-warning">Personne politiquement exposée</Badge> : 'Standard'}
                </Info>
                {data.agency && <Info label="Agence d'enregistrement">{data.agency.code} — {data.agency.name}</Info>}
                {data.createdBy && <Info label="Enregistré par">{data.createdBy.fullName}</Info>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Documents</h2></div>
            {data.attachments && data.attachments.length > 0 ? (
              <div className="card-pad stack-sm">
                {data.attachments.map((a) => (
                  <div key={a.id} className="between" style={{ padding: '6px 0' }}>
                    <div>
                      <div className="small strong">{a.filename}</div>
                      <div className="small muted">{formatBytes(a.sizeBytes)} · {formatDate(a.createdAt)}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => viewFile(a.id)}>Ouvrir</button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Aucun document" hint="Les pièces jointes s'affichent ici." />
            )}
          </div>

          <div className="card card-pad">
            <div className="between">
              <span className="muted small">Opérations enregistrées</span>
              <Link href={`/transactions${'?clientId=' + data.id}`} className="small">Voir →</Link>
            </div>
            <div className="strong" style={{ fontSize: '1.4rem' }}>{data._count?.transactions ?? 0}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="muted" style={{ width: '42%' }}>{label}</td>
      <td>{children}</td>
    </tr>
  );
}
