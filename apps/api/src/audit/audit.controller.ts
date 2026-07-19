import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

@ApiTags('Audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Journal d'audit, filtrable et pagine.
   *
   * Reserve a l'ADMIN conformement au cahier des charges. Si la BCC doit un
   * jour controler la piste d'audit elle-meme, ajouter Role.BCC ici suffit :
   * le ReadOnlyGuard garantit deja qu'elle ne pourra rien y ecrire.
   */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Consulter le journal d\'audit' })
  findAll(@Query() query: QueryAuditDto) {
    return this.auditService.findAll(query);
  }

  @Get('actions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lister les actions auditables (pour les filtres)' })
  actions() {
    return Object.values(AuditAction);
  }
}
