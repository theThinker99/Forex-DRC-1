'use client';

import { useState } from 'react';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAsync, Spinner, Notice, Badge, EmptyState, Modal, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import type { Paginated, Agency } from '@/lib/types';

export default function AgenciesPage() {
  const list = useAsync(
    (s) => api.get<Paginated<Agency>>(`/agencies${toQuery({ limit: 50 })}`, s),
    [],
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async (a: Agency) => {
    if (!confirm(`Fermer l'agence ${a.name} ? Elle restera consultable mais n'acceptera plus d'opérations.`)) return;
    try {
      await api.delete(`/agencies/${a.id}`);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
    }
  };

  return (
    <>
      <PageHeader
        title="Agences"
        subtitle="Réseau de bureaux de change."
        actions={<button className="btn btn-accent" onClick={() => setCreating(true)}>＋ Nouvelle agence</button>}
      />

      {error && <div style={{ marginBottom: 16 }}><Notice kind="danger">{error}</Notice></div>}

      <div className="card">
        {list.loading ? (
          <Spinner />
        ) : list.data && list.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Nom</th>
                  <th>Ville</th>
                  <th>Agrément</th>
                  <th className="num">Utilisateurs</th>
                  <th className="num">Opérations</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="mono strong">{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.city}</td>
                    <td className="small mono">{a.licenseNo ?? '—'}</td>
                    <td className="num">{a._count?.users ?? 0}</td>
                    <td className="num">{a._count?.transactions ?? 0}</td>
                    <td>
                      <Badge className={a.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}>
                        {a.status === 'ACTIVE' ? 'Active' : 'Fermée'}
                      </Badge>
                    </td>
                    <td>
                      {a.status === 'ACTIVE' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => close(a)} style={{ color: 'var(--danger-700)' }}>
                          Fermer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Aucune agence" />
        )}
      </div>

      {creating && (
        <CreateAgencyModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />
      )}
    </>
  );
}

function CreateAgencyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', city: '', commune: '', address: '', phone: '', licenseNo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/agencies', {
        code: form.code,
        name: form.name,
        city: form.city,
        commune: form.commune || undefined,
        address: form.address || undefined,
        phone: form.phone || undefined,
        licenseNo: form.licenseNo || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouvelle agence"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy || !form.code || !form.name || !form.city}>
            {busy ? <span className="spinner" /> : 'Créer'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="stack" style={{ marginTop: error ? 12 : 0 }}>
        <div className="grid grid-2">
          <Field label="Code" required hint="2 à 8 caractères. Immuable.">
            <input className="input" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="GOM" />
          </Field>
          <Field label="Ville" required>
            <input className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Goma" />
          </Field>
        </div>
        <Field label="Nom" required>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Bureau de change Goma Centre" />
        </Field>
        <div className="grid grid-2">
          <Field label="Commune"><input className="input" value={form.commune} onChange={(e) => set({ commune: e.target.value })} /></Field>
          <Field label="Téléphone"><input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+243…" /></Field>
        </div>
        <Field label="Adresse"><input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="N° d'agrément BCC"><input className="input" value={form.licenseNo} onChange={(e) => set({ licenseNo: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
