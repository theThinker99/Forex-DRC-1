import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../common/types/authenticated-user';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Duree de vie du refresh token, pour caler le Max-Age du cookie. */
  refreshExpiresAt: Date;
}

interface Context {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** SHA-256 suffit ici : le token est deja une valeur aleatoire a haute entropie. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Emet un couple access/refresh et ouvre une nouvelle chaine de rotation.
   * Appele a la connexion (locale ou Google).
   */
  async issue(user: User, context: Context = {}): Promise<IssuedTokens> {
    return this.mint(user, randomUUID(), context);
  }

  /**
   * Rotation du refresh token.
   *
   * Le token presente est invalide immediatement et remplace. Si un token
   * deja revoque est presente, c'est qu'il a ete rejoue : on revoque toute la
   * chaine, ce qui deconnecte l'attaquant *et* la victime — comportement
   * voulu, la victime se reconnectera avec ses identifiants.
   */
  async rotate(refreshToken: string, context: Context = {}): Promise<IssuedTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Session expiree. Veuillez vous reconnecter.');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      // Signature valide mais inconnu en base : token deja purge ou forge
      // avec un secret compromis. On revoque la famille par precaution.
      await this.revokeFamily(payload.fid);
      throw new UnauthorizedException('Session invalide. Veuillez vous reconnecter.');
    }

    if (stored.revokedAt !== null) {
      this.logger.warn(
        `Rejeu d'un refresh token revoque (utilisateur ${stored.userId}, famille ${stored.familyId}). ` +
          'Revocation de toute la chaine.',
      );
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'Session compromise : toutes les sessions ont ete fermees par securite. Veuillez vous reconnecter.',
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expiree. Veuillez vous reconnecter.');
    }

    if (stored.user.status !== 'ACTIF') {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Compte suspendu ou archive.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.mint(stored.user, stored.familyId, context);
  }

  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    // updateMany plutot que update : une deconnexion avec un token deja
    // inconnu doit reussir silencieusement, pas renvoyer une erreur.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ferme toutes les sessions d'un utilisateur (suspension, changement de mot de passe). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async mint(
    user: User,
    familyId: string,
    context: Context,
  ): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      // Present pour le confort du client ; le serveur relit toujours le role
      // en base a chaque requete (cf. JwtAuthGuard).
      role: user.role,
      agencyId: user.agencyId,
      name: user.fullName,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessTtl'),
    });

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: user.id, fid: familyId, jti };
    const refreshTtl = this.config.get<string>('jwt.refreshTtl') ?? '7d';

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: refreshTtl,
    });

    const refreshExpiresAt = new Date(Date.now() + parseDuration(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Purge des tokens expires. A brancher sur une tache planifiee. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}

/** "15m" | "7d" | "3600" -> millisecondes. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Duree invalide : "${value}". Format attendu : 900, 15m, 24h ou 7d.`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factors: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * factors[unit];
}
