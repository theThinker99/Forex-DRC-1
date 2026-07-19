'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  setAccessToken,
  setSessionLostHandler,
} from './api';
import type { CurrentUser, LoginResponse } from './types';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  loginLocal: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const handleSessionLost = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionLostHandler(handleSessionLost);
  }, [handleSessionLost]);

  // Au chargement : on tente un refresh silencieux. Si le cookie httpOnly est
  // encore valide, l'utilisateur retrouve sa session sans se reconnecter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const data = (await res.json()) as LoginResponse;
          if (!cancelled) {
            setAccessToken(data.accessToken);
            setUser(data.user);
          }
        }
      } catch {
        // Pas de session : on reste sur l'ecran de connexion.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLogin = useCallback((data: LoginResponse) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const loginLocal = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<LoginResponse>(
        '/auth/login',
        { email, password },
        { noRetry: true },
      );
      applyLogin(data);
      router.push('/');
    },
    [applyLogin, router],
  );

  const loginGoogle = useCallback(
    async (credential: string) => {
      const data = await api.post<LoginResponse>(
        '/auth/google',
        { credential },
        { noRetry: true },
      );
      applyLogin(data);
      router.push('/');
    },
    [applyLogin, router],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Meme si l'appel echoue, on nettoie l'etat local.
    }
    setAccessToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<CurrentUser>('/auth/me');
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSessionLost();
      }
    }
  }, [handleSessionLost]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, loginLocal, loginGoogle, logout, refreshUser }),
    [user, loading, loginLocal, loginGoogle, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre utilise dans AuthProvider.');
  return ctx;
}
