import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { AlertsService } from './alerts.service';
import { QueryAlertsDto, ResolveAlertDto } from './dto/alert.dto';

@ApiTags('Alertes')
@ApiBearerAuth('access-token')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Le cabiste est exclu : les alertes portent sur son propre travail. */
  @Get()
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Lister les alertes' })
  findAll(@Query() query: QueryAlertsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.alerts.findAll(query, user);
  }

  @Get('count')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Nombre d\'alertes ouvertes (pastille de notification)' })
  count(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.openCount(user);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Detail d\'une alerte' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alerts.findOne(id, user);
  }

  /**
   * La BCC est absente de cette liste : elle constate, elle ne traite pas.
   * Le ReadOnlyGuard bloquerait de toute facon ce PATCH.
   */
  @Patch(':id/resolve')
  @Roles(Role.ADMIN, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Traiter une alerte' })
  resolve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResolveAlertDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alerts.resolve(id, dto, user);
  }
}
