'use client';

import React from 'react';
import type { PaginatedMeta } from '@/lib/types';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ padding: '32px', justifyContent: 'center' }}>
      <span className="spinner" aria-hidden />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
}) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function Badge({
  className = 'badge-neutral',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`badge ${className}`}>{children}</span>;
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="center" style={{ padding: '40px 20px', color: 'var(--ink-500)' }}>
      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--ink-700)' }}>{title}</div>
      {hint && <div className="small" style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {required && <span style={{ color: 'var(--danger-600)' }}> *</span>}
      </label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function Pagination({
  meta,
  onPage,
}: {
  meta: PaginatedMeta;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span className="small muted">
        {meta.total.toLocaleString('fr-FR')} résultat{meta.total > 1 ? 's' : ''} — page{' '}
        {meta.page} / {meta.totalPages}
      </span>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!meta.hasPrevious}
        onClick={() => onPage(meta.page - 1)}
      >
        ‹ Précédent
      </button>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!meta.hasNext}
        onClick={() => onPage(meta.page + 1)}
      >
        Suivant ›
      </button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 100,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}
      >
        <div className="card-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="card-pad">{children}</div>
        {footer && (
          <div
            className="card-pad"
            style={{ borderTop: '1px solid var(--ink-200)', paddingTop: 16 }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Petit hook de chargement de donnees avec annulation propre. */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loader(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Erreur de chargement.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}
