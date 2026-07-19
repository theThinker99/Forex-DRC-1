import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, AuthProvider, Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { GoogleIdentityService } from './google-identity.service';
import { PasswordService } from './password.service';
import { IssuedTokens, TokensService } from './tokens.service';

export interface AuthContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedResult extends IssuedTokens {
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  agencyId: string | null;
  agency: { id: string; code: string; name: string } | null;
  authProvider: AuthProvider;
  googleLinked: boolean;
  hasPassword: boolean;
  lastLoginAt: Date | null;
}

/** Message unique pour tout echec de connexion locale : ne jamais reveler
 *  si c'est l'email ou le mot de passe qui est faux. */
const GENERIC_LOGIN_FAILURE = 'Email ou mot de passe incorrect.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly google: GoogleIdentityService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // -------------------------------------------------------------------------
  // Authentification locale
  // -------------------------------------------------------------------------

  async loginLocal(
    email: string,
    password: string,
    context: AuthContext,
  ): Promise<AuthenticatedResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    // Compte inconnu, ou compte Google sans mot de passe defini : dans les
    // deux cas on consomme le meme temps CPU qu'une verification reelle
    // avant de renvoyer le meme message.
    if (!user || !user.passwordHash) {
      await this.passwords.wasteTime(password);
      await this.traceFailure(email, context, user?.id ?? null);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) {
      await this.traceFailure(email, context, user.id);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    if (user.status !== UserStatus.ACTIF) {
      await this.traceFailure(email, context, user.id);
      throw new UnauthorizedException(
        user.status === UserStatus.SUSPENDU
          ? 'Compte suspendu. Contactez un administrateur.'
          : 'Compte archive. Contactez un administrateur.',
      );
    }

    return this.completeLogin(user, user.agency, context);
  }

  // -------------------------------------------------------------------------
  // Authentification Google
  // -------------------------------------------------------------------------

  /**
   * Google prouve l'identite ; le role vient toujours de la base.
   *
   * Trois cas :
   *  1. googleId deja connu           -> connexion.
   *  2. email connu, pas encore lie   -> liaison automatique puis connexion.
   *  3. email inconnu                 -> creation seulement si l'admin a
   *     active l'auto-provisionnement, avec le role par defaut qu'il a fixe.
   */
  async loginGoogle(
    credential: string,
    context: AuthContext,
  ): Promise<AuthenticatedResult> {
    const identity = await this.google.verify(credential);

    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId: identity.googleId },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    if (byGoogleId) {
      this.assertActive(byGoogleId);
      return this.completeLogin(byGoogleId, byGoogleId.agency, context);
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email: identity.email },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    if (byEmail) {
      this.assertActive(byEmail);

      // Liaison : l'email Google est verifie, il prouve donc bien la propriete
      // de l'adresse. Le role et l'agence existants ne sont pas touches.
      const linked = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: identity.googleId },
        include: { agency: { select: { id: true, code: true, name: true } } },
      });

      await this.audit.log({
        actor: { id: linked.id, email: linked.email, role: linked.role },
        action: AuditAction.LIAISON_GOOGLE,
        entity: 'User',
        entityId: linked.id,
        after: { googleId: identity.googleId, provider: 'GOOGLE' },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return this.completeLogin(linked, linked.agency, context);
    }

    return this.provisionFromGoogle(identity, context);
  }

  /**
   * Creation d'un compte depuis Google.
   *
   * Desactive par defaut : sur une plateforme de change, laisser n'importe
   * quel detenteur de compte Google creer un acces serait une faille beante.
   * L'admin doit activer explicitement l'auto-provisionnement et choisir le
   * role par defaut (parametre `auth.google.autoProvision`). Le compte cree
   * est SUSPENDU tant qu'un admin ne l'a pas active et affecte a une agence.
   */
  private async provisionFromGoogle(
    identity: { googleId: string; email: string; fullName: string },
    context: AuthContext,
  ): Promise<AuthenticatedResult> {
    const policy = await this.settings.googleAutoProvision();

    if (!policy.enabled) {
      this.logger.warn(
        `Connexion Google refusee pour ${identity.email} : aucun compte local et auto-provisionnement desactive.`,
      );
      throw new UnauthorizedException(
        'Aucun compte n\'est associe a cette adresse Google. ' +
          'Demandez a un administrateur de vous creer un acces.',
      );
    }

    const created = await this.prisma.user.create({
      data: {
        fullName: identity.fullName,
        email: identity.email,
        googleId: identity.googleId,
        authProvider: AuthProvider.GOOGLE,
        passwordHash: null,
        role: policy.defaultRole,
        // Jamais ACTIF a la creation : un humain doit valider l'acces et
        // rattacher le compte a son agence.
        status: UserStatus.SUSPENDU,
      },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    await this.audit.log({
      actor: null,
      action: AuditAction.CREATION,
      entity: 'User',
      entityId: created.id,
      after: {
        email: created.email,
        role: created.role,
        status: created.status,
        origine: 'auto-provisionnement Google',
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    throw new UnauthorizedException(
      'Votre compte vient d\'etre cree et attend l\'activation par un administrateur.',
    );
  }

  // -------------------------------------------------------------------------
  // Liaison / deliaison Google sur un compte existant
  // -------------------------------------------------------------------------

  async linkGoogle(
    userId: string,
    credential: string,
    context: AuthContext,
  ): Promise<PublicUser> {
    const identity = await this.google.verify(credential);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');

    if (user.googleId && user.googleId !== identity.googleId) {
      throw new ConflictException(
        'Un autre compte Google est deja lie a cet utilisateur. Deliez-le d\'abord.',
      );
    }

    // L'email Google doit correspondre au compte : sinon n'importe qui
    // pourrait greffer son identite Google sur le compte d'un collegue.
    if (identity.email !== user.email) {
      throw new ConflictException(
        `Ce compte Google (${identity.email}) ne correspond pas a l'adresse du compte (${user.email}).`,
      );
    }

    const owner = await this.prisma.user.findUnique({
      where: { googleId: identity.googleId },
    });
    if (owner && owner.id !== user.id) {
      throw new ConflictException(
        'Ce compte Google est deja lie a un autre utilisateur.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { googleId: identity.googleId },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    await this.audit.log({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.LIAISON_GOOGLE,
      entity: 'User',
      entityId: user.id,
      before: { googleId: user.googleId },
      after: { googleId: identity.googleId },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.toPublicUser(updated, updated.agency);
  }

  async unlinkGoogle(userId: string, context: AuthContext): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (!user.googleId) {
      throw new BadRequestException('Aucun compte Google n\'est lie.');
    }
    // Delier sans mot de passe rendrait le compte inaccessible.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Definissez d\'abord un mot de passe : sans lui, delier Google vous priverait de tout moyen de connexion.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { googleId: null, authProvider: AuthProvider.LOCAL },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });

    await this.audit.log({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.MODIFICATION,
      entity: 'User',
      entityId: user.id,
      before: { googleId: user.googleId },
      after: { googleId: null },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.toPublicUser(updated, updated.agency);
  }

  // -------------------------------------------------------------------------
  // Mot de passe
  // -------------------------------------------------------------------------

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuthContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Ce compte n\'a pas de mot de passe. Utilisez la definition initiale de mot de passe.',
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit etre different de l\'ancien.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });

    // Un changement de mot de passe doit chasser les sessions volees.
    await this.tokens.revokeAllForUser(user.id);

    await this.audit.log({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.MODIFICATION,
      entity: 'User',
      entityId: user.id,
      after: { evenement: 'changement de mot de passe', sessionsFermees: true },
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  /** Definition initiale : reservee aux comptes crees via Google. */
  async setInitialPassword(
    userId: string,
    newPassword: string,
    context: AuthContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.passwordHash) {
      throw new BadRequestException(
        'Ce compte a deja un mot de passe. Utilisez le changement de mot de passe.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });

    await this.audit.log({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.MODIFICATION,
      entity: 'User',
      entityId: user.id,
      after: { evenement: 'definition initiale du mot de passe' },
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, context: AuthContext): Promise<AuthenticatedResult> {
    const issued = await this.tokens.rotate(refreshToken, context);
    const payload = await this.me(await this.userIdFromTokens(issued.accessToken));
    return { ...issued, user: payload };
  }

  async logout(refreshToken: string | undefined, actor: { id: string; email: string; role: Role } | null, context: AuthContext): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    }
    if (actor) {
      await this.audit.log({
        actor,
        action: AuditAction.DECONNEXION,
        entity: 'User',
        entityId: actor.id,
        ip: context.ip,
        userAgent: context.userAgent,
      });
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agency: { select: { id: true, code: true, name: true } } },
    });
    if (!user) throw new NotFoundException('Compte introuvable.');
    return this.toPublicUser(user, user.agency);
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  private async completeLogin(
    user: User,
    agency: { id: string; code: string; name: string } | null,
    context: AuthContext,
  ): Promise<AuthenticatedResult> {
    const tokens = await this.tokens.issue(user, context);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.CONNEXION,
      entity: 'User',
      entityId: user.id,
      after: { provider: user.googleId ? 'google-ou-local' : 'local' },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { ...tokens, user: this.toPublicUser(user, agency) };
  }

  private assertActive(user: User): void {
    if (user.status !== UserStatus.ACTIF) {
      throw new UnauthorizedException(
        user.status === UserStatus.SUSPENDU
          ? 'Compte suspendu. Contactez un administrateur.'
          : 'Compte archive. Contactez un administrateur.',
      );
    }
  }

  private async traceFailure(
    email: string,
    context: AuthContext,
    userId: string | null,
  ): Promise<void> {
    await this.audit.log({
      actor: null,
      action: AuditAction.CONNEXION_ECHOUEE,
      entity: 'User',
      entityId: userId,
      after: { email },
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  private async userIdFromTokens(accessToken: string): Promise<string> {
    // L'access token vient d'etre signe par nous : le decoder sans re-verifier
    // est sans risque ici, et evite un aller-retour de configuration.
    const [, payload] = accessToken.split('.');
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { sub: string };
    return decoded.sub;
  }

  private toPublicUser(
    user: User,
    agency: { id: string; code: string; name: string } | null,
  ): PublicUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      agencyId: user.agencyId,
      agency,
      authProvider: user.authProvider,
      googleLinked: user.googleId !== null,
      hasPassword: user.passwordHash !== null,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
