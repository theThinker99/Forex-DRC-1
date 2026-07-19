'use client';

import { useState } from 'react';
import { api, toQuery } from '@/lib/api';
import { useAsync, Spinner, Notice, Badge, EmptyState, Pagination, Modal } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatDateTime, actionLabel, ROLE_LABELS } from '@/lib/format';
import type { Paginated, AuditLog } from '@/lib/types';

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const actions = useAsync((s) => api.get<string[]>('/audit-logs/actions', s), []);
  const list = useAsync(
    (s) => api.get<Paginated<AuditLog>>(`/audit-logs${toQuery({ action, search: applied, page, limit: 30 })}`, s),
    [action, applied, page],
  );

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle="Trace immuable de toutes les actions sensibles."
      />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap">
          <input className="input grow" style={{ minWidth: 200 }} placeholder="E-mail de l'auteur, identifiant…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setPage(1), setApplied(search))} />
          <select className="select" style={{ maxWidth: 220 }} value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
            <option value="">Toutes les actions</option>
            {actions.data?.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { setPage(1); setApplied(search); }}>Rechercher</button>
        </div>
      </div>

      <div className="card">
        {list.loading ? (
          <Spinner />
        ) : list.error ? (
          <div className="card-pad"><Notice kind="danger">{list.error}</Notice></div>
        ) : list.data && list.data.data.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Horodatage</th>
                    <th>Auteur</th>
                    <th>Action</th>
                    <th>Entité</th>
                    <th>IP</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((log) => (
                    <tr key={log.id}>
                      <td className="small nowrap">{formatDateTime(log.createdAt)}</td>
                      <td className="small">
                        <div>{log.actor?.fullName ?? log.actorEmail}</div>
                        {log.actorRole && <div className="muted">{ROLE_LABELS[log.actorRole]}</div>}
                      </td>
                      <td><Badge className={badgeFor(log.action)}>{actionLabel(log.action)}</Badge></td>
                      <td className="small">
                        {log.entity}
                        {log.entityId && <div className="mono muted" style={{ fontSize: '0.7rem' }}>{log.entityId.slice(0, 8)}…</div>}
                      </td>
                      <td className="small mono muted">{log.ip ?? '—'}</td>
                      <td>
                        {(log.before != null || log.after != null) && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setDetail(log)}>Détail</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--ink-200)' }}>
              <Pagination meta={list.data.meta} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState title="Aucune entrée" />
        )}
      </div>

      {detail && (
        <Modal title={`${actionLabel(detail.action)} · ${detail.entity}`} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="small muted">{formatDateTime(detail.createdAt)} · {detail.actorEmail}</div>
            {detail.before != null && (
              <div>
                <div className="small strong">Avant</div>
                <pre style={preStyle}>{JSON.stringify(detail.before, null, 2)}</pre>
              </div>
            )}
            {detail.after != null && (
              <div>
                <div className="small strong">Après</div>
                <pre style={preStyle}>{JSON.stringify(detail.after, null, 2)}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

const preStyle: React.CSSProperties = {
  background: 'var(--ink-050)',
  border: '1px solid var(--ink-200)',
  borderRadius: 6,
  padding: 12,
  fontSize: '0.75rem',
  overflow: 'auto',
  maxHeight: 240,
  margin: '4px 0 0',
};

function badgeFor(action: string): string {
  if (action.includes('SUPPRESSION') || action.includes('REJET') || action.includes('ANNULATION') || action === 'CONNEXION_ECHOUEE') return 'badge-danger';
  if (action.includes('CREATION') || action === 'VALIDATION') return 'badge-success';
  if (action === 'CONNEXION' || action === 'CONSULTATION') return 'badge-neutral';
  return 'badge-info';
}
