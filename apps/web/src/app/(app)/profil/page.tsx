'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Notice, Field, Badge } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { ROLE_LABELS, formatDateTime } from '@/lib/format';

export default function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  if (!user) return null;

  const changePassword = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (user.hasPassword) {
        await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      } else {
        await api.post('/auth/set-password', { newPassword: next });
      }
      setMsg({ kind: 'success', text: 'Mot de passe mis à jour. Vous allez être déconnecté.' });
      await refreshUser();
      setTimeout(() => logout(), 1500);
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Échec.' });
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Mon profil" subtitle="Informations du compte et sécurité." />

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Informations</h2></div>
          <div className="card-pad">
            <table className="table">
              <tbody>
                <tr><td className="muted">Nom</td><td className="strong">{user.fullName}</td></tr>
                <tr><td className="muted">E-mail</td><td>{user.email}</td></tr>
                <tr><td className="muted">Rôle</td><td><Badge className="badge-neutral">{ROLE_LABELS[user.role]}</Badge></td></tr>
                <tr><td className="muted">Agence</td><td>{user.agency ? `${user.agency.code} — ${user.agency.name}` : 'Périmètre national'}</td></tr>
                <tr><td className="muted">Google</td><td>{user.googleLinked ? <Badge className="badge-success">Lié</Badge> : 'Non lié'}</td></tr>
                <tr><td className="muted">Dernière connexion</td><td className="small">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>{user.hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}</h2></div>
          <div className="card-pad stack">
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            {user.hasPassword && (
              <Field label="Mot de passe actuel" required>
                <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
              </Field>
            )}
            <Field label="Nouveau mot de passe" required hint="Min. 12 caractères, 1 majuscule, 1 minuscule, 1 chiffre.">
              <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <div className="row">
              <button className="btn btn-primary" onClick={changePassword} disabled={busy || next.length < 12 || (user.hasPassword && !current)}>
                {busy ? <span className="spinner" /> : 'Enregistrer'}
              </button>
            </div>
            <p className="small muted">Le changement de mot de passe ferme toutes vos sessions.</p>
          </div>
        </div>
      </div>
    </>
  );
}
