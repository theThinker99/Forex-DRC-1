import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
}

/**
 * Verification des jetons Google Identity Services.
 *
 * Ce service ne fait qu'une chose : prouver *qui* est la personne.
 * Il ne renvoie deliberement aucune notion de role, de groupe ou de domaine
 * exploitable comme privilege : l'autorisation est lue en base (User.role).
 */
@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);
  private readonly client: OAuth2Client | null;
  private readonly clientId: string | null;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string | null>('google.clientId') ?? null;
    this.client = this.clientId ? new OAuth2Client(this.clientId) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Verifie la signature, l'audience et l'expiration du jeton d'identite.
   * `verifyIdToken` recupere et met en cache les cles publiques de Google.
   */
  async verify(credential: string): Promise<GoogleIdentity> {
    if (!this.client || !this.clientId) {
      throw new ServiceUnavailableException(
        'La connexion Google n\'est pas configuree sur ce serveur.',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `Jeton Google rejete : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      throw new UnauthorizedException('Jeton Google invalide ou expire.');
    }

    if (!payload) {
      throw new UnauthorizedException('Jeton Google illisible.');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('Jeton Google sans identifiant utilisateur.');
    }
    if (!payload.email) {
      throw new UnauthorizedException(
        'Le compte Google ne communique pas d\'adresse email : impossible de le rattacher a un compte local.',
      );
    }
    // Un email non verifie peut appartenir a quelqu'un d'autre : le rattacher
    // a un compte local permettrait une usurpation par simple revendication.
    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'L\'adresse email de ce compte Google n\'est pas verifiee.',
      );
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase().trim(),
      emailVerified: true,
      fullName: payload.name?.trim() || payload.email.split('@')[0],
    };
  }
}
