'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, toQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Notice, Field, Badge, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatRate, DOC_TYPE_LABELS } from '@/lib/format';
import { currencyName } from '@/lib/currencies';
import type {
  Client,
  Currency,
  IdDocumentType,
  Paginated,
  RateBoardEntry,
  Transaction,
  TransactionType,
} from '@/lib/types';

type Step = 'client' | 'operation';

const DOC_TYPES: IdDocumentType[] = [
  'CARTE_ELECTEUR',
  'PASSEPORT',
  'PERMIS_CONDUIRE',
  'CARTE_SERVICE',
  'CARTE_REFUGIE',
  'AUTRE',
];

export default function NewTransactionPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('client');
  const [client, setClient] = useState<Client | null>(null);
  const [board, setBoard] = useState<RateBoardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preloading, setPreloading] = useState(false);

  useEffect(() => {
    api.get<RateBoardEntry[]>('/exchange-rates/board').then(setBoard).catch(() => undefined);
  }, []);

  // Pre-selection d'un client via ?clientId=... (bouton "Nouvelle operation"
  // depuis la fiche/liste client). On lit l'URL cote client pour eviter la
  // contrainte de Suspense de useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('clientId');
    if (!clientId) return;
    setPreloading(true);
    api
      .get<Client>(`/clients/${clientId}`)
      .then((c) => {
        setClient(c);
        setStep('operation');
      })
      .catch(() => setError('Client pré-sélectionné introuvable. Recherchez-le manuellement.'))
      .finally(() => setPreloading(false));
  }, []);

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Nouvelle opération de change"
        subtitle="Identifiez le client, puis saisissez l'opération."
      />

      <div className="row" style={{ marginBottom: 20, gap: 8 }}>
        <StepPill index={1} label="Client" active={step === 'client'} done={!!client} />
        <div style={{ flex: '0 0 32px', height: 2, background: 'var(--ink-200)' }} />
        <StepPill index={2} label="Opération" active={step === 'operation'} done={false} />
      </div>

      {error && <div style={{ marginBottom: 16 }}><Notice kind="danger">{error}</Notice></div>}

      {preloading ? (
        <Spinner label="Chargement du client…" />
      ) : step === 'client' ? (
        <ClientStep
          onSelected={(c) => {
            setClient(c);
            setStep('operation');
            setError(null);
          }}
          onError={setError}
        />
      ) : client ? (
        <OperationStep
          client={client}
          board={board}
          onBack={() => setStep('client')}
          onDone={(t) => router.push(`/transactions/${t.id}`)}
          onError={setError}
        />
      ) : null}
    </>
  );
}

function StepPill({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: '0.8rem',
          background: done ? 'var(--success-700)' : active ? 'var(--brand-800)' : 'var(--ink-200)',
          color: done || active ? 'white' : 'var(--ink-500)',
        }}
      >
        {done ? '✓' : index}
      </div>
      <span className="strong" style={{ color: active ? 'var(--ink-900)' : 'var(--ink-500)' }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etape 1 : recherche unifiee (nom / prenom / telephone / piece) + creation
// ---------------------------------------------------------------------------

function ClientStep({
  onSelected,
  onError,
}: {
  onSelected: (client: Client) => void;
  onError: (msg: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Client[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  const runSearch = async () => {
    if (search.trim().length < 2) {
      onError('Saisissez au moins 2 caractères (nom, téléphone ou numéro de pièce).');
      return;
    }
    onError(null);
    setSearching(true);
    setCreating(false);
    try {
      // La base clients est nationale : recherche par nom, prénom, téléphone
      // ou numéro de pièce, toutes agences confondues.
      const page = await api.get<Paginated<Client>>(
        `/clients${toQuery({ search: search.trim(), limit: 15 })}`,
      );
      setResults(page.data);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Recherche impossible.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="card card-pad">
        <Field
          label="Rechercher un client"
          hint="Par nom, prénom, numéro de téléphone ou numéro de pièce d'identité."
        >
          <div className="row-wrap">
            <input
              className="input grow"
              style={{ minWidth: 220 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Ex. : Mukendi, +24399…, 19-A12345…"
              autoFocus
            />
            <button className="btn btn-primary" onClick={runSearch} disabled={searching}>
              {searching ? <span className="spinner" /> : '🔍 Rechercher'}
            </button>
          </div>
        </Field>

        {results !== null && (
          <div style={{ marginTop: 14 }}>
            {results.length > 0 ? (
              <div className="stack-sm">
                {results.map((c) => (
                  <div
                    key={c.id}
                    className="between"
                    style={{
                      padding: '10px 12px',
                      border: '1px solid var(--ink-200)',
                      borderRadius: 'var(--radius-sm)',
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="strong">
                        {c.fullName}
                        {c.isPep && <> · <Badge className="badge-warning">PPE</Badge></>}
                      </div>
                      <div className="small muted">
                        {DOC_TYPE_LABELS[c.idDocumentType]} · <span className="mono">{c.idDocumentNo}</span>
                        {c.phone && <> · {c.phone}</>}
                      </div>
                      {/* Base nationale : on montre d'ou vient le client. */}
                      {c.agency && (
                        <div className="small muted">
                          Enregistré à {c.agency.name}
                          {c.createdBy && <> par {c.createdBy.fullName}</>}
                        </div>
                      )}
                    </div>
                    <button className="btn btn-success btn-sm nowrap" onClick={() => onSelected(c)}>
                      Sélectionner →
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Notice kind="info">
                Aucun client trouvé pour « {search} ». Vous pouvez créer sa fiche.
              </Notice>
            )}
            <button
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? '× Annuler la création' : '＋ Nouveau client'}
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewClientForm
          initialName={results && results.length === 0 ? search : ''}
          onCreated={onSelected}
          onError={onError}
        />
      )}
    </div>
  );
}

function NewClientForm({
  initialName,
  onCreated,
  onError,
}: {
  initialName: string;
  onCreated: (client: Client) => void;
  onError: (msg: string | null) => void;
}) {
  const [docType, setDocType] = useState<IdDocumentType>('CARTE_ELECTEUR');
  const [docNo, setDocNo] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [isPep, setIsPep] = useState(false);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      onError('Renseignez le prénom et le nom du client.');
      return;
    }
    if (docNo.trim().length < 4) {
      onError('Renseignez le numéro de pièce (min. 4 caractères).');
      return;
    }
    onError(null);
    setSaving(true);
    try {
      const created = await api.post<Client>('/clients', {
        firstName,
        lastName,
        idDocumentType: docType,
        idDocumentNo: docNo,
        phone: phone || undefined,
        isPep,
      });
      onCreated(created);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>Nouveau client</h3>
      <div className="grid grid-2">
        <Field label="Prénom" required>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Nom" required>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Type de pièce" required>
          <select className="select" value={docType} onChange={(e) => setDocType(e.target.value as IdDocumentType)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Numéro de pièce" required>
          <input className="input" value={docNo} onChange={(e) => setDocNo(e.target.value.toUpperCase())} placeholder="19-A12345-67890" />
        </Field>
        <Field label="Téléphone">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243…" />
        </Field>
        <div className="field">
          <label>Profil</label>
          <label className="row" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={isPep} onChange={(e) => setIsPep(e.target.checked)} />
            <span className="small">Personne politiquement exposée</span>
          </label>
        </div>
      </div>
      <button className="btn btn-accent" style={{ marginTop: 12 }} onClick={create} disabled={saving}>
        {saving ? <span className="spinner" /> : 'Créer et continuer →'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etape 2 : saisie de l'operation avec apercu de conversion en direct
// ---------------------------------------------------------------------------

function OperationStep({
  client,
  board,
  onBack,
  onDone,
  onError,
}: {
  client: Client;
  board: RateBoardEntry[];
  onBack: () => void;
  onDone: (t: Transaction) => void;
  onError: (msg: string | null) => void;
}) {
  const { user } = useAuth();

  // Devises réellement disponibles (un taux est publié). Sans taux, pas
  // d'opération possible : inutile de les proposer.
  const availableCurrencies = useMemo(
    () => board.filter((b) => b.available).map((b) => b.currency),
    [board],
  );

  const [type, setType] = useState<TransactionType>('ACHAT');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [commission, setCommission] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const canOverride = user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR';
  const [override, setOverride] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Cale la devise sélectionnée sur la première disponible.
  useEffect(() => {
    if (availableCurrencies.length && !availableCurrencies.includes(currency)) {
      setCurrency(availableCurrencies[0]);
    }
  }, [availableCurrencies, currency]);

  const entry = board.find((b) => b.currency === currency);
  const rate = useMemo(() => {
    if (override) return Number(override);
    if (!entry?.rate) return null;
    return Number(type === 'ACHAT' ? entry.rate.buyRate : entry.rate.sellRate);
  }, [override, entry, type]);

  const preview = useMemo(() => {
    const a = Number(amount);
    const comm = Number(commission) || 0;
    if (!rate || !Number.isFinite(a) || a <= 0) return null;
    const gross = type === 'ACHAT' ? a * rate : a / rate;
    const toAmount = gross - comm;
    return {
      fromCurrency: type === 'ACHAT' ? currency : 'CDF',
      toCurrency: type === 'ACHAT' ? 'CDF' : currency,
      gross,
      toAmount,
    };
  }, [amount, commission, rate, type, currency]);

  const submit = async () => {
    onError(null);
    if (!preview || preview.toAmount <= 0) {
      onError('Vérifiez le montant : le net à remettre au client doit être positif.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<Transaction>('/transactions', {
        clientId: client.id,
        type,
        foreignCurrency: currency,
        fromAmount: amount,
        commission: commission || undefined,
        rateOverride: override || undefined,
        rateOverrideReason: override ? overrideReason : undefined,
      });

      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('transactionId', created.id);
        fd.append('kind', 'PIECE_IDENTITE');
        await api.postForm('/attachments', fd).catch(() => undefined);
      }

      onDone(created);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Échec de l'enregistrement.");
      setSubmitting(false);
    }
  };

  const noCurrencies = availableCurrencies.length === 0;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
      <div className="card card-pad stack">
        <div className="between">
          <div style={{ minWidth: 0 }}>
            <div className="strong">{client.fullName}</div>
            <div className="small muted">
              {DOC_TYPE_LABELS[client.idDocumentType]} · <span className="mono">{client.idDocumentNo}</span>
              {client.agency && <> · {client.agency.name}</>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm nowrap" onClick={onBack}>← Changer</button>
        </div>
        <hr className="divider" />

        {noCurrencies ? (
          <Notice kind="danger">
            Aucun taux n&apos;est publié. Publiez d&apos;abord un taux dans la rubrique « Taux de change ».
          </Notice>
        ) : (
          <>
            <div className="grid grid-2">
              <Field label="Sens de l'opération" required>
                <select className="select" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
                  <option value="ACHAT">Achat — le client remet des devises</option>
                  <option value="VENTE">Vente — le client remet des CDF</option>
                </select>
              </Field>
              <Field label="Devise" required hint={currencyName(currency)}>
                <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  {availableCurrencies.map((c) => (
                    <option key={c} value={c}>{c} — {currencyName(c)}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label={`Montant remis par le client (${type === 'ACHAT' ? currency : 'CDF'})`}
              required
            >
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0.00" />
            </Field>

            <Field label={`Commission (${type === 'ACHAT' ? 'CDF' : currency}, facultatif)`}>
              <input className="input" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value.replace(',', '.'))} placeholder="0.00" />
            </Field>

            {canOverride && (
              <details>
                <summary className="small strong" style={{ cursor: 'pointer', color: 'var(--accent-700)' }}>
                  Taux dérogatoire
                </summary>
                <div className="stack-sm" style={{ marginTop: 10 }}>
                  <Notice kind="warning">
                    Un taux hors grille déclenche une alerte de contrôle. Réservé aux cas justifiés.
                  </Notice>
                  <Field label="Taux dérogatoire (CDF pour 1 devise)">
                    <input className="input" inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value.replace(',', '.'))} />
                  </Field>
                  {override && (
                    <Field label="Motif (obligatoire, min. 10 caractères)" required>
                      <textarea className="textarea" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    </Field>
                  )}
                </div>
              </details>
            )}

            <Field label="Photo de la pièce d'identité (facultatif — JPEG/PNG/PDF, 5 Mo max.)">
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          </>
        )}
      </div>

      <div className="card" style={{ position: 'sticky', top: 84 }}>
        <div className="card-head"><h2>Aperçu</h2></div>
        <div className="card-pad stack-sm">
          {!rate ? (
            <Notice kind="info">Choisissez une devise et un montant pour voir le calcul.</Notice>
          ) : (
            <>
              <div className="between">
                <span className="muted small">Taux appliqué</span>
                <span className="strong mono">{formatRate(rate)} CDF</span>
              </div>
              <div className="between">
                <span className="muted small">Le client remet</span>
                <span className="strong">
                  {amount ? formatMoney(amount, type === 'ACHAT' ? currency : 'CDF') : '—'}
                </span>
              </div>
              {commission && (
                <div className="between">
                  <span className="muted small">Commission</span>
                  <span>{formatMoney(commission, type === 'ACHAT' ? 'CDF' : currency)}</span>
                </div>
              )}
              <hr className="divider" />
              <div className="between">
                <span className="strong">Le client reçoit</span>
                <span className="strong" style={{ fontSize: '1.3rem', color: 'var(--brand-800)' }}>
                  {preview ? formatMoney(preview.toAmount, preview.toCurrency as Currency) : '—'}
                </span>
              </div>
            </>
          )}

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 12 }}
            onClick={submit}
            disabled={submitting || noCurrencies || !preview || (!!override && overrideReason.trim().length < 10)}
          >
            {submitting ? <span className="spinner" /> : 'Enregistrer l\'opération'}
          </button>
          <p className="small muted center" style={{ margin: 0 }}>
            Au-delà de 5 000 USD, l&apos;opération attend la validation d&apos;un superviseur.
          </p>
        </div>
      </div>
    </div>
  );
}
