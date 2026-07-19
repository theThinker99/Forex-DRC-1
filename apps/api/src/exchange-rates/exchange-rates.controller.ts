import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { resolveAgencyFilter } from '../common/scope/agency-scope';
import { ExchangeRatesService } from './exchange-rates.service';
import {
  CreateExchangeRateDto,
  QueryExchangeRatesDto,
} from './dto/exchange-rate.dto';

@ApiTags('Taux de change')
@ApiBearerAuth('access-token')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISEUR, Role.CABISTE)
  @ApiOperation({
    summary: 'Publier un nouveau taux',
    description:
      'Cloture automatiquement le taux precedent de la meme paire. ' +
      'L\'ADMIN peut publier un taux national ou par agence ; le CABISTE et le ' +
      'SUPERVISEUR uniquement pour leur propre agence. L\'historique est conserve.',
  })
  create(@Body() dto: CreateExchangeRateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rates.create(dto, user);
  }

  /** Tableau des taux en vigueur. Consulte a chaque saisie au guichet. */
  @Get('board')
  @ApiOperation({ summary: 'Taux actuellement en vigueur' })
  @ApiQuery({ name: 'agencyId', required: false })
  board(
    @CurrentUser() user: AuthenticatedUser,
    @Query('agencyId') agencyId?: string,
  ) {
    return this.rates.board(resolveAgencyFilter(user, agencyId) ?? null);
  }

  @Get()
  @ApiOperation({ summary: 'Historique des taux' })
  findAll(@Query() query: QueryExchangeRatesDto) {
    return this.rates.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d\'un taux' })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.rates.findOne(id);
  }
}
