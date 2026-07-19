import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CashService } from './cash.service';
import {
  CloseCashSessionDto,
  OpenCashSessionDto,
  QueryCashSessionsDto,
} from './dto/cash-session.dto';

@ApiTags('Caisse')
@ApiBearerAuth('access-token')
@Controller('cash-sessions')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Post('open')
  @Roles(Role.CABISTE, Role.SUPERVISEUR)
  @ApiOperation({
    summary: 'Ouvrir sa caisse (declarer les fonds par devise)',
    description: 'Facultatif. Une seule caisse ouverte a la fois par operateur.',
  })
  open(@Body() dto: OpenCashSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cash.open(dto, user);
  }

  @Get('current')
  @Roles(Role.CABISTE, Role.SUPERVISEUR)
  @ApiOperation({
    summary: 'Ma caisse ouverte + son résumé du jour',
    description: 'Renvoie null si aucune caisse n\'est ouverte.',
  })
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.cash.currentForUser(user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR, Role.CABISTE)
  @ApiOperation({ summary: 'Historique des caisses' })
  findAll(@Query() query: QueryCashSessionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cash.findAll(query, user);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR, Role.CABISTE)
  @ApiOperation({ summary: 'Résumé détaillé d\'une caisse' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cash.findOne(id, user);
  }

  @Patch(':id/close')
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({
    summary: 'Clôturer une caisse',
    description:
      'Fige la session et calcule les soldes théoriques par devise, ainsi que ' +
      'les écarts si les montants comptés sont fournis.',
  })
  close(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cash.close(id, dto, user);
  }
}
