import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgencyStatus,
  AuditAction,
  AuthProvider,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokensService } from '../auth/tokens.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateUserDto,
  QueryUsersDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './dto/user.dto';

/** Roles dont le perimetre est national : ils ne sont rattaches a aucune agence. */
const NATIONAL_ROLES: ReadonlySet<Role> = new Set([Role.ADMIN, Role.BCC]);

/** Champs exposes. `passwordHash` n'apparait jamais dans une reponse. */
const USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  agencyId: true,
  authProvider: true,
  googleId: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  agency: { select: { id: true, code: true, name: true, city: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    this.assertAgencyCoherence(dto.role, dto.agencyId);

    if (dto.agencyId) {
      await this.assertAgencyOpen(dto.agencyId);
    }

    // Sans mot de passe, le compte n'est utilisable que par connexion Google :
    // la liaison se fera automatiquement a la premiere connexion sur cet email.
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone ?? null,
        role: dto.role,
        agencyId: dto.agencyId ?? null,
        passwordHash: dto.password ? await this.passwords.hash(dto.password) : null,
        authProvider: dto.password ? AuthProvider.LOCAL : AuthProvider.GOOGLE,
        status: UserStatus.ACTIF,
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      actor,
      action: AuditAction.CREATION,
      entity: 'User',
      entityId: user.id,
      after: user,
    });

    return user;
  }

  async findAll(query: QueryUsersDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.UserWhereInput = {};

    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.agencyId) where.agencyId = query.agencyId;
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  /** Cabistes d'une agence, pour les filtres de la BCC et du superviseur. */
  async operators(agencyId?: string) {
    return this.prisma.user.findMany({
      where: {
        role: Role.CABISTE,
        status: UserStatus.ACTIF,
        ...(agencyId ? { agencyId } : {}),
      },
      select: { id: true, fullName: true, email: true, agencyId: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        _count: { select: { transactions: true, clientsCreated: true } },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!before) throw new NotFoundException('Utilisateur introuvable.');

    const nextRole = dto.role ?? before.role;
    const nextAgencyId =
      dto.agencyId !== undefined ? dto.agencyId : before.agencyId ?? undefined;

    this.assertAgencyCoherence(nextRole, nextAgencyId ?? undefined);

    if (dto.agencyId) {
      await this.assertAgencyOpen(dto.agencyId);
    }

    // Un admin qui se retire ses propres droits se verrouille dehors, et la
    // correction demande alors un acces direct a la base.
    if (id === actor.id) {
      if (dto.role && dto.role !== before.role) {
        throw new BadRequestException(
          'Vous ne pouvez pas modifier votre propre role. Demandez a un autre administrateur.',
        );
      }
      if (dto.status && dto.status !== UserStatus.ACTIF) {
        throw new BadRequestException(
          'Vous ne pouvez pas suspendre ou archiver votre propre compte.',
        );
      }
    }

    const losesAdmin = before.role === Role.ADMIN && nextRole !== Role.ADMIN;
    const losesActive =
      before.status === UserStatus.ACTIF && dto.status && dto.status !== UserStatus.ACTIF;
    if (before.role === Role.ADMIN && (losesAdmin || losesActive)) {
      await this.assertNotLastAdmin(id);
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
        status: dto.status,
        // `null` explicite pour detacher un compte promu ADMIN/BCC.
        agencyId: dto.agencyId !== undefined ? dto.agencyId : undefined,
        ...(NATIONAL_ROLES.has(nextRole) ? { agencyId: null } : {}),
      },
      select: USER_SELECT,
    });

    // Tout changement de droits ou de statut doit prendre effet tout de
    // suite : le JwtAuthGuard relit le role a chaque requete, mais les
    // sessions ouvertes n'ont plus lieu d'etre si le compte est ferme.
    const roleChanged = before.role !== after.role;
    const deactivated = after.status !== UserStatus.ACTIF;
    if (roleChanged || deactivated) {
      await this.tokens.revokeAllForUser(id);
    }

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'User',
      entityId: id,
      before,
      after: { ...after, sessionsFermees: roleChanged || deactivated },
    });

    return after;
  }

  /**
   * Archivage (suppression logique).
   *
   * Un utilisateur ayant saisi des transactions ne peut pas etre efface :
   * son identite est un element du bordereau et de la piste d'audit. On le
   * sort donc du circuit sans toucher a l'historique.
   */
  async archive(id: string, actor: AuthenticatedUser) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!before) throw new NotFoundException('Utilisateur introuvable.');

    if (id === actor.id) {
      throw new BadRequestException('Vous ne pouvez pas archiver votre propre compte.');
    }
    if (before.status === UserStatus.ARCHIVE) {
      throw new BadRequestException('Ce compte est deja archive.');
    }
    if (before.role === Role.ADMIN) {
      await this.assertNotLastAdmin(id);
    }

    const pending = await this.prisma.transaction.count({
      where: { operatorId: id, status: 'EN_ATTENTE' },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `Impossible d'archiver ce compte : ${pending} operation(s) qu'il a saisies attendent encore une validation.`,
      );
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ARCHIVE },
      select: USER_SELECT,
    });

    await this.tokens.revokeAllForUser(id);

    await this.audit.log({
      actor,
      action: AuditAction.SUPPRESSION,
      entity: 'User',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /** Reinitialisation par l'admin. Ferme toutes les sessions du compte cible. */
  async resetPassword(id: string, dto: ResetPasswordDto, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        authProvider: AuthProvider.LOCAL,
      },
    });

    await this.tokens.revokeAllForUser(id);

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'User',
      entityId: id,
      after: {
        evenement: 'reinitialisation du mot de passe par un administrateur',
        cible: user.email,
        sessionsFermees: true,
      },
    });

    return { message: 'Mot de passe reinitialise. Les sessions du compte ont ete fermees.' };
  }

  // -------------------------------------------------------------------------

  /**
   * ADMIN et BCC ont un perimetre national : leur rattacher une agence
   * suggererait un cloisonnement qui n'existe pas. CABISTE et SUPERVISEUR
   * sans agence seraient, eux, inutilisables (aucune donnee visible).
   */
  private assertAgencyCoherence(role: Role, agencyId?: string | null): void {
    if (NATIONAL_ROLES.has(role)) {
      if (agencyId) {
        throw new BadRequestException(
          `Le role ${role} a un perimetre national : il ne peut pas etre rattache a une agence.`,
        );
      }
      return;
    }

    if (!agencyId) {
      throw new BadRequestException(
        `Le role ${role} doit etre rattache a une agence.`,
      );
    }
  }

  private async assertAgencyOpen(agencyId: string): Promise<void> {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, status: true, name: true },
    });
    if (!agency) throw new BadRequestException('Agence introuvable.');
    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new BadRequestException(
        `L'agence "${agency.name}" est fermee : aucun utilisateur ne peut y etre affecte.`,
      );
    }
  }

  /** Garde-fou : le systeme doit toujours conserver au moins un admin actif. */
  private async assertNotLastAdmin(excludingId: string): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: {
        role: Role.ADMIN,
        status: UserStatus.ACTIF,
        id: { not: excludingId },
      },
    });
    if (remaining === 0) {
      throw new ForbiddenException(
        'Operation refusee : ce compte est le dernier administrateur actif. ' +
          'Creez ou activez un autre administrateur au prealable.',
      );
    }
  }
}
