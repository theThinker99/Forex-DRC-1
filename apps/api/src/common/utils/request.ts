import { Request } from 'express';

/**
 * Adresse IP du client.
 *
 * Derriere un reverse proxy, `req.ip` renvoie l'IP du proxy. Express ne lit
 * X-Forwarded-For que si `trust proxy` est active (fait dans main.ts) ; on
 * garde ici un repli explicite pour ne jamais journaliser une IP vide.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim().slice(0, 64);
  }
  return request.ip?.slice(0, 64) ?? request.socket?.remoteAddress?.slice(0, 64) ?? null;
}

export function userAgent(request: Request): string | null {
  return request.headers['user-agent']?.slice(0, 255) ?? null;
}
