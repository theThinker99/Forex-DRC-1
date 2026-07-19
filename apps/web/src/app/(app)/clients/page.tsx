'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Spinner, Notice, Badge, EmptyState, Pagination } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatDate, DOC_TYPE_LABELS } from '@/lib/format';
import type { Paginated, Client, AgencyRef } from '@/lib/types';

export default function ClientsPage() {
  const { user } = useAuth();
  const canFilterAgency = user?.role === 'ADMIN' || user?.role === 'BCC';
  // La BCC est en lecture seule : pas de bouton d'opération pour elle.
  const canOperate =
    user?.role === 'CABISTE' || user?.role === 'SUPERVISEUR' || user?.role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Client> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agencies, setAgencies] = useState<AgencyRef[]>([]);

  useEffect(() => {
    if (canFilterAgency) {
      api.get<AgencyRef[]>('/agencies/options').then(setAgencies).catch(() => undefined);
    }
  }, [canFilterAgency]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<Paginated<Client>>(
        `/clients${toQuery({ search: applied, agencyId, page, limit: 20 })}`,
        controller.signal,
      )
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Erreur.');
      })
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [applied, agencyId, page]);

  return (
    <>
      <PageHeader title="Clients" subtitle="Fiches clients et pièces d'identité." />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap">
          <input
            className="input grow"
            style={{ minWidth: 220 }}
            placeholder="Nom, numéro de pièce, téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setPage(1), setApplied(search))}
          />
          {canFilterAgency && (
            <select className="select" style={{ maxWidth: 240 }} value={agencyId} onChange={(e) => { setPage(1); setAgencyId(e.target.value); }}>
              <option value="">Toutes les agences</option>
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={() => { setPage(1); setApplied(search); }}>
            Rechercher
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="card-pad"><Notice kind="danger">{error}</Notice></div>
        ) : data && data.data.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Pièce</th>
                    <th>Téléphone</th>
                    <th>Opérations</th>
                    <th>Enregistré</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="strong">{c.fullName}</div>
                        {c.isPep && <Badge className="badge-warning">PPE</Badge>}
                      </td>
                      <td className="small">
                        {DOC_TYPE_LABELS[c.idDocumentType]}
                        <div className="mono muted">{c.idDocumentNo}</div>
                      </td>
                      <td className="small">{c.phone ?? '—'}</td>
                      <td className="num">{c._count?.transactions ?? 0}</td>
                      <td className="small muted">{formatDate((c as unknown as { createdAt: string }).createdAt ?? new Date())}</td>
                      <td>
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Link href={`/clients/${c.id}`} className="btn btn-ghost btn-sm">Fiche</Link>
                          {canOperate && (
                            <Link href={`/transactions/nouvelle?clientId=${c.id}`} className="btn btn-accent btn-sm nowrap">
                              ＋ Opération
                            </Link>
                          )}
                        </div>
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
          <EmptyState title="Aucun client" hint="Les clients apparaissent après leur première opération." />
        )}
      </div>
    </>
  );
}
