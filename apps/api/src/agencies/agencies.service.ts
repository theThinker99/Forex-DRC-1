import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgencyStatus, AuditAction, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateAgencyDto,
  QueryAgenciesDto,
  UpdateAgencyDto,
} from './dto/agency.dto';

@Injectable()
export class AgenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateAgencyDto, actor: AuthenticatedUser) {
    const agency = await this.prisma.agency.create({ data: dto });

    await this.audit.log({
      actor,
      action: AuditAction.CREATION,
      entity: 'Agency',
      entityId: agency.id,
      after: agency,
    });

    return agency;
  }

  async findAll(query: QueryAgenciesDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AgencyWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.agency.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: query.skip,
        take: query.limit,
        include: {
          _count: { select: { users: true, transactions: true, clients: true } },
        },
      }),
      this.prisma.agency.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  /** Liste allegee pour alimenter les listes deroulantes du frontend. */
  async options() {
    return this.prisma.agency.findMany({
      where: { status: AgencyStatus.ACTIVE },
      select: { id: true, code: true, name: true, city: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, transactions: true, clients: true } },
      },
    });
    if (!agency) throw new NotFoundException('Agence introuvable.');
    return agency;
  }

  async update(id: string, dto: UpdateAgencyDto, actor: AuthenticatedUser) {
    const before = await this.prisma.agency.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Agence introuvable.');

    if (dto.status === AgencyStatus.FERMEE && before.status !== AgencyStatus.FERMEE) {
      await this.assertClosable(id);
    }

    const after = await this.prisma.agency.update({ where: { id }, data: dto });

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'Agency',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /**
   * Fermeture logique. Aucune suppression physique : les transactions
   * historiques doivent rester rattachables a leur agence pour tout controle
   * BCC ulterieur, meme des annees apres la fermeture du guichet.
   */
  async close(id: string, actor: AuthenticatedUser) {
    const before = await this.prisma.agency.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Agence introuvable.');
    if (before.status === AgencyStatus.FERMEE) {
      throw new BadRequestException('Cette agence est deja fermee.');
    }

    await this.assertClosable(id);

    const after = await this.prisma.agency.update({
      where: { id },
      data: { status: AgencyStatus.FERMEE },
    });

    await this.audit.log({
      actor,
      action: AuditAction.SUPPRESSION,
      entity: 'Agency',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /**
   * On refuse de fermer une agence dont des operations sont encore en
   * attente : elles deviendraient invalidables, personne n'ayant plus le
   * perimetre pour les traiter.
   */
  private async assertClosable(agencyId: string): Promise<void> {
    const [activeUsers, pendingTransactions] = await this.prisma.$transaction([
      this.prisma.user.count({
        where: { agencyId, status: UserStatus.ACTIF },
      }),
      this.prisma.transaction.count({
        where: { agencyId, status: 'EN_ATTENTE' },
      }),
    ]);

    const blockers: string[] = [];
    if (activeUsers > 0) {
      blockers.push(
        `${activeUsers} utilisateur(s) actif(s) y sont encore rattaches`,
      );
    }
    if (pendingTransactions > 0) {
      blockers.push(
        `${pendingTransactions} operation(s) y sont encore en attente de validation`,
      );
    }

    if (blockers.length > 0) {
      throw new BadRequestException(
        `Impossible de fermer cette agence : ${blockers.join(' et ')}.`,
      );
    }
  }
}
