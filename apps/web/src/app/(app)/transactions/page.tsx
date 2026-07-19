'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Spinner, Notice, Badge, EmptyState, Pagination } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import {
  formatMoney,
  formatDateTime,
  STATUS_META,
  TYPE_LABELS,
} from '@/lib/format';
import type {
  Paginated,
  Transaction,
  TransactionStatus,
  TransactionType,
  Currency,
  AgencyRef,
} from '@/lib/types';

interface Filters {
  search: string;
  status: '' | TransactionStatus;
  type: '' | TransactionType;
  currency: '' | Currency;
  agencyId: string;
  operatorId: string;
  dateFrom: string;
  dateTo: string;
  minUsd: string;
  maxUsd: string;
}

const EMPTY: Filters = {
  search: '',
  status: '',
  type: '',
  currency: '',
  agencyId: '',
  operatorId: '',
  dateFrom: '',
  dateTo: '',
  minUsd: '',
  maxUsd: '',
};

export default function TransactionsPage() {
  const { user } = useAuth();
  const canFilterAgency = user?.role === 'ADMIN' || user?.role === 'BCC';
  const canExport = user?.role === 'ADMIN' || user?.role === 'BCC' || user?.role === 'SUPERVISEUR';
  const canFilterOperator = user?.role !== 'CABISTE';

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Transaction> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [agencies, setAgencies] = useState<AgencyRef[]>([]);
  const [operators, setOperators] = useState<Array<{ id: string; fullName: string }>>([]);

  useEffect(() => {
    if (canFilterAgency) {
      api.get<AgencyRef[]>('/agencies/options').then(setAgencies).catch(() => undefined);
    }
    if (canFilterOperator) {
      api
        .get<Array<{ id: string; fullName: string }>>('/users/operators')
        .then(setOperators)
        .catch(() => undefined);
    }
  }, [canFilterAgency, canFilterOperator]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const query = toQuery({ ...applied, page, limit: 20 });
        const result = await api.get<Paginated<Transaction>>(`/transactions${query}`, signal);
        setData(result);
      } catch (err) {
        // Une requete annulee (filtre change avant la fin) ne doit pas afficher d'erreur.
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Erreur de chargement.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [applied, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const apply = () => {
    setPage(1);
    setApplied(filters);
  };

  const reset = () => {
    setFilters(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.raw(`/transactions/export${toQuery({ ...applied })}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `operations-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'export.");
    } finally {
      setExporting(false);
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      <PageHeader
        title="Opérations de change"
        subtitle={
          user?.role === 'CABISTE'
            ? 'Vos opérations.'
            : user?.role === 'BCC'
              ? 'Toutes les opérations — consultation et contrôle.'
              : 'Recherche et suivi des opérations.'
        }
        actions={
          canExport && (
            <button className="btn btn-ghost" onClick={exportCsv} disabled={exporting || !data?.data.length}>
              {exporting ? <span className="spinner" /> : '⭳ Exporter CSV'}
            </button>
          )
        }
      />

      {/* Filtres avances */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="grid grid-4">
          <div className="field">
            <label>Recherche</label>
            <input
              className="input"
              placeholder="Référence, client, pièce…"
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
            />
          </div>
          <div className="field">
            <label>Statut</label>
            <select className="select" value={filters.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })}>
              <option value="">Tous</option>
              {(['EN_ATTENTE', 'VALIDEE', 'REJETEE', 'ANNULEE'] as TransactionStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Sens</label>
            <select className="select" value={filters.type} onChange={(e) => set({ type: e.target.value as Filters['type'] })}>
              <option value="">Tous</option>
              <option value="ACHAT">Achat</option>
              <option value="VENTE">Vente</option>
            </select>
          </div>
          <div className="field">
            <label>Devise</label>
            <select className="select" value={filters.currency} onChange={(e) => set({ currency: e.target.value as Filters['currency'] })}>
              <option value="">Toutes</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="CDF">CDF</option>
            </select>
          </div>

          {canFilterAgency && (
            <div className="field">
              <label>Agence</label>
              <select className="select" value={filters.agencyId} onChange={(e) => set({ agencyId: e.target.value })}>
                <option value="">Toutes</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
          )}
          {canFilterOperator && (
            <div className="field">
              <label>Cabiste</label>
              <select className="select" value={filters.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
                <option value="">Tous</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.fullName}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Du</label>
            <input className="input" type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
          </div>
          <div className="field">
            <label>Au</label>
            <input className="input" type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
          </div>
          <div className="field">
            <label>Montant USD min.</label>
            <input className="input" inputMode="decimal" placeholder="0" value={filters.minUsd} onChange={(e) => set({ minUsd: e.target.value })} />
          </div>
          <div className="field">
            <label>Montant USD max.</label>
            <input className="input" inputMode="decimal" placeholder="∞" value={filters.maxUsd} onChange={(e) => set({ maxUsd: e.target.value })} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={apply}>Rechercher</button>
          <button className="btn btn-ghost" onClick={reset}>Réinitialiser</button>
        </div>
      </div>

      {/* Resultats */}
      <div className="card">
        {loading ? (
          <Spinner label="Chargement des opérations…" />
        ) : error ? (
          <div className="card-pad"><Notice kind="danger">{error}</Notice></div>
        ) : data && data.data.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Référence / Date</th>
                    <th>Client</th>
                    {canFilterOperator && <th>Cabiste</th>}
                    <th>Sens</th>
                    <th className="num">Remis</th>
                    <th className="num">Reçu</th>
                    <th className="num">USD</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="mono small strong">{t.reference}</div>
                        <div className="small muted">{formatDateTime(t.occurredAt)}</div>
                      </td>
                      <td>
                        <div>{t.client.fullName}</div>
                        <div className="small muted mono">{t.client.idDocumentNo}</div>
                      </td>
                      {canFilterOperator && <td className="small">{t.operator.fullName}</td>}
                      <td>
                        <Badge className={t.type === 'ACHAT' ? 'badge-accent' : 'badge-neutral'}>
                          {TYPE_LABELS[t.type]}
                        </Badge>
                      </td>
                      <td className="num small nowrap">{formatMoney(t.fromAmount, t.fromCurrency)}</td>
                      <td className="num small nowrap">{formatMoney(t.toAmount, t.toCurrency)}</td>
                      <td className="num nowrap strong">{formatMoney(t.usdEquivalent)}</td>
                      <td>
                        <Badge className={STATUS_META[t.status].badge}>
                          {STATUS_META[t.status].label}
                        </Badge>
                        {t._count && t._count.alerts > 0 && (
                          <span title="Alertes" style={{ marginLeft: 6, color: 'var(--danger-600)' }}>⚑</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/transactions/${t.id}`} className="btn btn-ghost btn-sm">
                          Détails
                        </Link>
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
          <EmptyState title="Aucune opération trouvée" hint="Ajustez les filtres ou élargissez la période." />
        )}
      </div>
    </>
  );
}
