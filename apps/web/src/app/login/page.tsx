'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Field, Notice } from '@/components/ui';
import { Logo } from '@/components/logo';
import type { AuthProviders } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    google?: any;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, loginLocal, loginGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Deja connecte : on quitte l'ecran de login.
  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  useEffect(() => {
    api
      .get<AuthProviders>('/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({ local: true, google: false, googleClientId: null }));
  }, []);

  // Initialise le bouton Google une fois le script charge ET la config connue.
  useEffect(() => {
    if (!googleReady || !providers?.google || !providers.googleClientId) return;
    if (!window.google || !googleButtonRef.current) return;

    window.google.accounts.id.initialize({
      client_id: providers.googleClientId,
      callback: async (response: { credential: string }) => {
        setError(null);
        setSubmitting(true);
        try {
          await loginGoogle(response.credential);
        } catch (err) {
          setError(messageOf(err));
          setSubmitting(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'continue_with',
      locale: 'fr',
    });
  }, [googleReady, providers, loginGoogle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginLocal(email, password);
    } catch (err) {
      setError(messageOf(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      {/* Fond : image de billets (a deposer dans public/login-bg.jpg) recouverte
          d'un voile bleu nuit translucide pour garder le texte lisible. Si
          l'image est absente, seul le degrade s'affiche — rien ne casse. */}
      <div className="login-bg" aria-hidden />
      <div className="login-overlay" aria-hidden />

      {providers?.google && providers.googleClientId && (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleReady(true)}
        />
      )}

      <div className="login-card-wrap">
        <div className="center" style={{ marginBottom: 24, color: 'var(--white)' }}>
          <div style={{ display: 'inline-flex', marginBottom: 12 }}>
            <Logo size={64} />
          </div>
          <h1 style={{ color: 'var(--white)', fontSize: '1.5rem', letterSpacing: '0.01em' }}>
            Forex DRC
          </h1>
          <p style={{ color: 'var(--ink-300)', margin: '6px 0 0', fontSize: '0.9rem' }}>
            Plateforme de change manuel — accès sécurisé
          </p>
        </div>

        <div className="card card-pad">
          <form className="stack" onSubmit={submit}>
            {error && <Notice kind="danger">{error}</Notice>}

            <Field label="Adresse e-mail" required>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@change-rdc.cd"
                required
                autoFocus
              />
            </Field>

            <Field label="Mot de passe" required>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={submitting}
            >
              {submitting ? <span className="spinner" /> : 'Se connecter'}
            </button>
          </form>

          {providers?.google && providers.googleClientId && (
            <>
              <div className="row" style={{ margin: '18px 0', color: 'var(--ink-400)' }}>
                <hr className="grow" style={{ border: 0, borderTop: '1px solid var(--ink-200)' }} />
                <span className="small">ou</span>
                <hr className="grow" style={{ border: 0, borderTop: '1px solid var(--ink-200)' }} />
              </div>
              <div className="row" style={{ justifyContent: 'center' }} ref={googleButtonRef} />
              <p className="small muted center" style={{ marginTop: 10 }}>
                La connexion Google prouve votre identité. Vos droits restent ceux
                définis par l&apos;administrateur.
              </p>
            </>
          )}
        </div>

        <p className="small center" style={{ color: 'var(--ink-400)', marginTop: 16 }}>
          Accès réservé au personnel habilité. Toutes les actions sont journalisées.
        </p>
      </div>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Connexion impossible. Réessayez.';
}
