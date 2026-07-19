'use client';

/**
 * Client HTTP de l'API.
 *
 * Deux principes de securite cote client :
 *  1. L'access token vit en memoire (jamais localStorage) : une XSS ne peut
 *     donc pas le lire dans un stockage persistant.
 *  2. Le refresh token est un cookie httpOnly gere par le navigateur : ce
 *     code ne le voit jamais. Sur un 401, on tente un refresh transparent.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

// Empeche N requetes concurrentes de declencher N refresh en parallele :
// la premiere refait le token, les autres attendent son resultat.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
        accessToken = data.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Laisse le microtask courant lire refreshPromise avant de le liberer.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Ne pas tenter de refresh sur 401 (utilise par le login lui-meme). */
  noRetry?: boolean;
  /** Reponse binaire (PDF, image) plutot que JSON. */
  raw?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  };

  let res = await doFetch();

  if (res.status === 401 && !options.noRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      onSessionLost?.();
      throw new ApiError(401, 'Session expiree. Veuillez vous reconnecter.');
    }
  }

  if (options.raw) {
    if (!res.ok) throw await toError(res);
    return (await res.blob()) as unknown as T;
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeParse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(data) ?? res.statusText, data);
  }
  return data as T;
}

async function toError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  const data = text ? safeParse(text) : undefined;
  return new ApiError(res.status, extractMessage(data) ?? res.statusText, data);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** L'API renvoie parfois message: string, parfois string[] (erreurs de validation). */
function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const message = (data as Record<string, unknown>).message;
  if (Array.isArray(message)) return message.join(' • ');
  if (typeof message === 'string') return message;
  return null;
}

/** Serialise un objet de filtres en query string, en omettant les valeurs vides. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  raw: (path: string, method: string = 'GET') =>
    request<Blob>(path, { method, raw: true }),
};
