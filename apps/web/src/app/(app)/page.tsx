'use client';

import Link from 'next/link';
import { api, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync, Spinner, Notice, Badge, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatDateTime, STATUS_META, ROLE_LABELS } from '@/lib/format';
import type {
  DashboardStats,
  Paginated,
  Transaction,
  RateBoardEntry,
} from '@/lib/types';

export default function DashboardPage() {
  const { user } = useAuth();

  const stats = useAsync(
    (signal) => api.get<DashboardStats>('/stats/dashboard', signal),
    [],
  );
  const board = useAsync(
    (signal) => api.get<RateBoardEntry[]>('/exchange-rates/board', signal),
    [],
  );
  const recent = useAsync(
    (signal) =>
      api.get<Paginated<Transaction>>(
        `/transactions${toQuery({ limit: 6, page: 1 })}`,
        signal,
      ),
    [],
  );

  if (!user) return null;

  const greeting =
    user.role === 'BCC'
      ? 'Vue de contrôle — lecture seule sur toutes les agences.'
      : user.role === 'CABISTE'
        ? 'Vos opérations et vos indicateurs personnels.'
        : user.role === 'SUPERVISEUR'
          ? `Supervision de ${user.agency?.name ?? 'votre agence'}.`
          : 'Vue consolidée de toutes les agences.';

  return (
    <>
      <PageHeader
        title={`Bonjour, ${user.fullName.split(' ')[0]}`}
        subtitle={greeting}
        actions={
          (user.role === 'CABISTE' || user.role === 'SUPERVISEUR' || user.role === 'ADMIN') && (
            <Link href="/transactions/nouvelle" className="btn btn-accent">
              ＋ Nouvelle opération
            </Link>
          )
        }
      />

      {/* Tuiles d'indicateurs */}
      {stats.loading ? (
        <Spinner label="Calcul des indicateurs…" />
      ) : stats.error ? (
        <Notice kind="danger">{stats.error}</Notice>
      ) : stats.data ? (
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          <div className="stat">
            <div className="stat-label">Volume (30 j)</div>
            <div className="stat-value">{formatMoney(stats.data.volumeUsd)}</div>
            <div className="stat-sub">USD — contre-valeur toutes devises</div>
          </div>
          <div className="stat">
            <div className="stat-label">Opérations</div>
            <div className="stat-value">{stats.data.operations.toLocaleString('fr-FR')}</div>
            <div className="stat-sub">{stats.data.clientsServis} clients servis</div>
          </div>
          <div className="stat">
            <div className="stat-label">En attente</div>
            <div className="stat-value" style={{ color: stats.data.enAttente > 0 ? 'var(--warning-700)' : undefined }}>
              {stats.data.enAttente}
            </div>
            <div className="stat-sub">à valider</div>
          </div>
          <div className="stat">
            <div className="stat-label">Alertes ouvertes</div>
            <div className="stat-value" style={{ color: stats.data.alertes.total > 0 ? 'var(--danger-700)' : undefined }}>
              {stats.data.alertes.total}
            </div>
            <div className="stat-sub">
              {stats.data.alertes.parGravite.find((g) => g.severity === 'CRITIQUE')?.nombre ?? 0} critiques
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
        {/* Operations recentes */}
        <div className="card">
          <div className="card-head">
            <h2>Dernières opérations</h2>
            <Link href="/transactions" className="small">
              Tout voir →
            </Link>
          </div>
          {recent.loading ? (
            <Spinner />
          ) : recent.data && recent.data.data.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Client</th>
                    <th>Sens</th>
                    <th className="num">Contre-valeur</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.data.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/transactions/${t.id}`} className="mono small">
                          {t.reference}
                        </Link>
                        <div className="small muted">{formatDateTime(t.occurredAt)}</div>
                      </td>
                      <td>{t.client.fullName}</td>
                      <td>
                        <Badge className={t.type === 'ACHAT' ? 'badge-accent' : 'badge-neutral'}>
                          {t.type}
                        </Badge>
                      </td>
                      <td className="num">{formatMoney(t.usdEquivalent, 'USD')}</td>
                      <td>
                        <Badge className={STATUS_META[t.status].badge}>
                          {STATUS_META[t.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Aucune opération" hint="Les opérations récentes s'afficheront ici." />
          )}
        </div>

        {/* Taux du jour */}
        <div className="card">
          <div className="card-head">
            <h2>Taux du jour</h2>
            <Link href="/taux" className="small">
              Détails →
            </Link>
          </div>
          <div className="card-pad stack">
            {board.loading ? (
              <Spinner />
            ) : board.data && board.data.some((e) => e.available) ? (
              board.data
                .filter((entry) => entry.available && entry.rate)
                .map((entry) => (
                  <div key={entry.currency} className="between" style={{ padding: '4px 0' }}>
                    <div className="row">
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          background: 'var(--ink-100)',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          color: 'var(--brand-800)',
                        }}
                      >
                        {entry.currency}
                      </div>
                      <div>
                        <div className="strong">{entry.currency} / CDF</div>
                        <div className="small muted">
                          {entry.rate!.scope === 'agence' ? 'Taux agence' : 'Taux national'}
                        </div>
                      </div>
                    </div>
                    <div className="right">
                      <div className="small muted">Achat / Vente</div>
                      <div className="strong mono">
                        {formatMoney(entry.rate!.buyRate)} / {formatMoney(entry.rate!.sellRate)}
                      </div>
                    </div>
                  </div>
                ))
            ) : (
              <div className="small muted">Aucun taux publié pour le moment.</div>
            )}
            <div className="small muted">
              Connecté en tant que <strong>{ROLE_LABELS[user.role]}</strong>.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
