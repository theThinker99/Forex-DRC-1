import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsService } from './stats.service';

@ApiTags('Statistiques')
@ApiBearerAuth('access-token')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * Synthese du dashboard. Ouverte a tous les roles : le perimetre est
   * resserre dans le service (le cabiste ne voit que ses propres chiffres).
   */
  @Get('dashboard')
  @ApiOperation({ summary: 'Indicateurs de synthese' })
  dashboard(@Query() query: StatsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stats.dashboard(query, user);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Volume journalier (graphique)' })
  timeseries(@Query() query: StatsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stats.timeseries(query, user);
  }

  /** Classement des cabistes : donnee de pilotage, hors du perimetre cabiste. */
  @Get('top-operators')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Cabistes les plus actifs' })
  topOperators(@Query() query: StatsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stats.topOperators(query, user);
  }
}
