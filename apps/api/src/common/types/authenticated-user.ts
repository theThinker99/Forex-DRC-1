import { Role } from '@prisma/client';
import { Request } from 'express';

/**
 * Identite resolue par le JwtAuthGuard et attachee a la requete.
 * `agencyId` est null pour ADMIN et BCC : leur perimetre est national.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  agencyId: string | null;
  fullName: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/** Payload signe dans l'access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  agencyId: string | null;
  name: string;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Identifie la chaine de rotation, pour detecter un rejeu. */
  fid: string;
  jti: string;
}
