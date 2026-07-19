'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAsync, Spinner, Notice, Badge, EmptyState, Pagination, Modal, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { ROLE_LABELS, formatDateTime } from '@/lib/format';
import type { Paginated, User, Role, AgencyRef } from '@/lib/types';

const ROLES: Role[] = ['ADMIN', 'BCC', 'SUPERVISEUR', 'CABISTE'];
const NATIONAL: Role[] = ['ADMIN', 'BCC'];

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [agencies, setAgencies] = useState<AgencyRef[]>([]);
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  useEffect(() => {
    api.get<AgencyRef[]>('/agencies/options').then(setAgencies).catch(() => undefined);
  }, []);

  const list = useAsync(
    (s) => api.get<Paginated<User>>(`/users${toQuery({ search: applied, role: roleFilter, page, limit: 20 })}`, s),
    [applied, roleFilter, page],
  );

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        subtitle="Comptes, rôles et rattachement aux agences."
        actions={<button className="btn btn-accent" onClick={() => setEditing('new')}>＋ Nouvel utilisateur</button>}
      />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap">
          <input className="input grow" style={{ minWidth: 200 }} placeholder="Nom ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setPage(1), setApplied(search))} />
          <select className="select" style={{ maxWidth: 200 }} value={roleFilter} onChange={(e) => { setPage(1); setRoleFilter(e.target.value as Role | ''); }}>
            <option value="">Tous les rôles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
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
                    <th>Nom</th>
                    <th>E-mail</th>
                    <th>Rôle</th>
                    <th>Agence</th>
                    <th>Connexion</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((u) => (
                    <tr key={u.id}>
                      <td className="strong">{u.fullName}</td>
                      <td className="small">
                        {u.email}
                        {u.googleId && <span title="Google lié" style={{ marginLeft: 6 }}>🔗</span>}
                      </td>
                      <td><Badge className="badge-neutral">{ROLE_LABELS[u.role]}</Badge></td>
                      <td className="small">{u.agency ? u.agency.code : '—'}</td>
                      <td className="small muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Jamais'}</td>
                      <td>
                        <Badge className={u.status === 'ACTIF' ? 'badge-success' : u.status === 'SUSPENDU' ? 'badge-warning' : 'badge-neutral'}>
                          {u.status === 'ACTIF' ? 'Actif' : u.status === 'SUSPENDU' ? 'Suspendu' : 'Archivé'}
                        </Badge>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>Modifier</button>
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
          <EmptyState title="Aucun utilisateur" />
        )}
      </div>

      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          agencies={agencies}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); list.reload(); }}
        />
      )}
    </>
  );
}

function UserModal({ user, agencies, onClose, onDone }: { user: User | null; agencies: AgencyRef[]; onClose: () => void; onDone: () => void }) {
  const isNew = user === null;
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'CABISTE');
  const [agencyId, setAgencyId] = useState(user?.agencyId ?? '');
  const [status, setStatus] = useState(user?.status ?? 'ACTIF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAgency = !NATIONAL.includes(role);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api.post('/users', {
          fullName,
          email,
          password: password || undefined,
          role,
          agencyId: needsAgency ? agencyId : undefined,
        });
      } else {
        await api.patch(`/users/${user!.id}`, {
          fullName,
          email,
          role,
          status,
          agencyId: needsAgency ? agencyId : null,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Nouvel utilisateur' : 'Modifier l\'utilisateur'}
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy || !fullName || !email || (needsAgency && !agencyId)}>
            {busy ? <span className="spinner" /> : isNew ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      {error && <Notice kind="danger">{error}</Notice>}
      <div className="stack" style={{ marginTop: error ? 12 : 0 }}>
        <Field label="Nom complet" required>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="E-mail" required>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {isNew && (
          <Field label="Mot de passe initial" hint="Laisser vide pour un compte Google uniquement (min. 12 car., 1 maj., 1 min., 1 chiffre).">
            <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-2">
          <Field label="Rôle" required>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          {needsAgency ? (
            <Field label="Agence" required>
              <select className="select" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">— choisir —</option>
                {agencies.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Périmètre"><input className="input" value="National" disabled /></Field>
          )}
        </div>
        {!isNew && (
          <Field label="Statut">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as User['status'])}>
              <option value="ACTIF">Actif</option>
              <option value="SUSPENDU">Suspendu</option>
              <option value="ARCHIVE">Archivé</option>
            </select>
          </Field>
        )}
        <Notice kind="info">
          Le rôle définit les droits dans l&apos;application. Il n&apos;est jamais déduit de Google.
        </Notice>
      </div>
    </Modal>
  );
}
