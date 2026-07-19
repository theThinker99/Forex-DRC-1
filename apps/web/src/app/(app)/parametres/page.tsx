'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAsync, Spinner, Notice, Field } from '@/components/ui';
import { PageHeader } from '@/components/page-header';

interface Setting {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
}

const TITLES: Record<string, string> = {
  'auth.google.autoProvision': 'Connexion Google',
  'aml.thresholds': 'Seuils de vigilance (LBC/FT)',
  'rates.policy': 'Politique de taux',
  'transactions.policy': 'Validation des opérations',
};

export default function SettingsPage() {
  const list = useAsync((s) => api.get<Setting[]>('/settings', s), []);

  return (
    <>
      <PageHeader
        title="Paramètres système"
        subtitle="Seuils, politique de taux et validation. Modifiables sans redéploiement."
      />
      {list.loading ? (
        <Spinner />
      ) : list.error ? (
        <Notice kind="danger">{list.error}</Notice>
      ) : (
        <div className="stack">
          {list.data?.map((setting) => (
            <SettingCard key={setting.key} setting={setting} onSaved={list.reload} />
          ))}
        </div>
      )}
    </>
  );
}

function SettingCard({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [value, setValue] = useState<Record<string, unknown>>(setting.value);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  const setField = (k: string, v: unknown) => setValue((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put(`/settings/${setting.key}`, { value });
      setMsg({ kind: 'success', text: 'Paramètre enregistré.' });
      onSaved();
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Échec.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{TITLES[setting.key] ?? setting.key}</h2>
          {setting.description && <div className="small muted" style={{ marginTop: 2 }}>{setting.description}</div>}
        </div>
      </div>
      <div className="card-pad stack">
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <div className="grid grid-2">
          {Object.entries(value).map(([k, v]) => (
            <Field key={k} label={FIELD_LABELS[k] ?? k}>
              {typeof v === 'boolean' ? (
                <label className="row" style={{ minHeight: 44 }}>
                  <input type="checkbox" checked={v} onChange={(e) => setField(k, e.target.checked)} />
                  <span className="small">{v ? 'Activé' : 'Désactivé'}</span>
                </label>
              ) : k === 'defaultRole' ? (
                <select className="select" value={String(v)} onChange={(e) => setField(k, e.target.value)}>
                  {['CABISTE', 'SUPERVISEUR', 'BCC'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input
                  className="input"
                  inputMode={typeof v === 'number' ? 'decimal' : 'text'}
                  value={String(v)}
                  onChange={(e) => setField(k, typeof v === 'number' ? Number(e.target.value) : e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  enabled: 'Auto-création de compte',
  defaultRole: 'Rôle par défaut',
  declarationUsd: 'Seuil de déclaration (USD)',
  alertUsd: 'Seuil d\'alerte (USD)',
  splittingCumulativeUsd: 'Cumul fractionnement (USD)',
  splittingWindowHours: 'Fenêtre (heures)',
  splittingOperationCount: 'Nb d\'opérations',
  maxDeviationPercent: 'Écart de taux toléré (%)',
  supervisorValidationAboveUsd: 'Validation superviseur au-delà de (USD)',
};
