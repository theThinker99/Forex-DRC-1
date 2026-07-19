'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Spinner } from './ui';
import { Logo } from './logo';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
}

// Une seule source de verite pour la navigation : chaque entree declare les
// roles qui la voient. Le backend reste l'autorite (RBAC par endpoint) ; ceci
// n'est qu'un confort d'affichage aligne dessus.
const NAV: NavItem[] = [
  { href: '/', label: 'Tableau de bord', icon: '▤', roles: ['ADMIN', 'BCC', 'CABISTE', 'SUPERVISEUR'] },
  { href: '/transactions', label: 'Opérations', icon: '⇄', roles: ['ADMIN', 'BCC', 'CABISTE', 'SUPERVISEUR'] },
  { href: '/transactions/nouvelle', label: 'Nouvelle opération', icon: '＋', roles: ['CABISTE', 'SUPERVISEUR', 'ADMIN'] },
  { href: '/caisse', label: 'Caisse', icon: '🧾', roles: ['CABISTE', 'SUPERVISEUR', 'ADMIN', 'BCC'] },
  { href: '/clients', label: 'Clients', icon: '👥', roles: ['ADMIN', 'BCC', 'CABISTE', 'SUPERVISEUR'] },
  { href: '/alertes', label: 'Alertes', icon: '⚑', roles: ['ADMIN', 'BCC', 'SUPERVISEUR'] },
  { href: '/taux', label: 'Taux de change', icon: '％', roles: ['ADMIN', 'BCC', 'CABISTE', 'SUPERVISEUR'] },
  { href: '/agences', label: 'Agences', icon: '🏢', roles: ['ADMIN'] },
  { href: '/utilisateurs', label: 'Utilisateurs', icon: '🔑', roles: ['ADMIN'] },
  { href: '/parametres', label: 'Paramètres', icon: '⚙', roles: ['ADMIN'] },
  { href: '/audit', label: "Journal d'audit", icon: '🕮', roles: ['ADMIN'] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Pastille d'alertes ouvertes pour les roles de controle.
  useEffect(() => {
    if (!user || user.role === 'CABISTE') return;
    let active = true;
    const load = () =>
      api
        .get<{ total: number }>('/alerts/count')
        .then((r) => active && setAlertCount(r.total))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user]);

  // Referme le menu mobile a chaque navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spinner label="Chargement…" />
      </div>
    );
  }

  const items = NAV.filter((item) => item.roles.includes(user.role));
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* Barre laterale */}
      <aside
        style={{
          width: 248,
          background: 'var(--brand-900)',
          color: 'var(--ink-200)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          inset: '0 auto 0 0',
          zIndex: 50,
          transform: menuOpen ? 'translateX(0)' : undefined,
        }}
        className={`app-sidebar ${menuOpen ? 'open' : ''}`}
      >
        <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={38} />
          <div>
            <div style={{ color: 'white', fontWeight: 700, lineHeight: 1 }}>Forex DRC</div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>
              {user.agency ? user.agency.name : 'Périmètre national'}
            </div>
          </div>
        </div>

        <nav className="stack-sm" style={{ padding: '8px 12px', gap: 2, flex: 1, overflowY: 'auto' }}>
          {items.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href) &&
                  // "Nouvelle operation" ne doit pas allumer "Operations".
                  !(item.href === '/transactions' && pathname.startsWith('/transactions/nouvelle'));
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={active}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '10px 12px',
                  borderRadius: 8,
                  color: active ? 'white' : 'var(--ink-300)',
                  background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                  fontSize: '0.9rem',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <span style={{ width: 20, textAlign: 'center', opacity: 0.9 }}>{item.icon}</span>
                <span className="grow">{item.label}</span>
                {item.href === '/alertes' && alertCount > 0 && (
                  <span className="badge badge-danger" style={{ padding: '1px 7px' }}>
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <Link
            href="/profil"
            className="row"
            style={{ padding: '8px 10px', borderRadius: 8, color: 'var(--ink-200)' }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--brand-600)',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {initials}
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ color: 'white', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.fullName}
              </div>
              <div className="small" style={{ color: 'var(--ink-400)' }}>
                {ROLE_LABELS[user.role]}
              </div>
            </div>
          </Link>
          <button
            className="btn btn-ghost btn-sm btn-block"
            style={{ marginTop: 8, color: 'var(--ink-200)', borderColor: 'rgba(255,255,255,0.15)' }}
            onClick={() => logout()}
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
          className="sidebar-backdrop"
        />
      )}

      {/* Contenu */}
      <div className="app-main" style={{ flex: 1, marginLeft: 248, minWidth: 0 }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            background: 'rgba(248,250,252,0.85)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid var(--ink-200)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            className="btn btn-ghost btn-sm menu-toggle"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu"
            style={{ display: 'none' }}
          >
            ☰
          </button>
          {user.role === 'BCC' && (
            <span className="badge badge-info">
              <span className="dot" /> Mode lecture seule
            </span>
          )}
          <div className="grow" />
        </header>

        <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>{children}</main>
      </div>

      <style>{`
        .nav-link:hover { background: rgba(255,255,255,0.06) !important; text-decoration: none; }
        @media (max-width: 900px) {
          .app-sidebar {
            transform: translateX(-100%);
            transition: transform 200ms ease;
          }
          .app-sidebar.open { transform: translateX(0); box-shadow: var(--shadow-lg); }
          .app-main { margin-left: 0 !important; }
          .menu-toggle { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
