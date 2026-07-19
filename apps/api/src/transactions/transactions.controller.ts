import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { TransactionsService } from './transactions.service';
import {
  CancelTransactionDto,
  CreateTransactionDto,
  QueryTransactionsDto,
  ReviewTransactionDto,
} from './dto/transaction.dto';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({
    summary: 'Enregistrer une operation de change',
    description:
      'Le taux est fige a la saisie. Au-dela du seuil parametre, l\'operation part ' +
      'en attente de validation par un superviseur ; en dessous, elle est validee ' +
      'immediatement et son bordereau est emis.',
  })
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transactions.create(dto, user);
  }

  /**
   * Ouvert a tous les roles : le perimetre est resserre dans le service.
   * Le cabiste ne recoit que ses operations, le superviseur celles de son
   * agence, l'ADMIN et la BCC l'ensemble du parc.
   */
  @Get()
  @ApiOperation({ summary: 'Rechercher des operations (filtres avances, pagination serveur)' })
  findAll(@Query() query: QueryTransactionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transactions.findAll(query, user);
  }

  @Get('export')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'Exporter les operations au format CSV',
    description: 'Applique les memes filtres que la recherche. Journalise dans l\'audit.',
  })
  async export(
    @Query() query: QueryTransactionsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.transactions.export(query, user);
    const filename = `operations-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d\'une operation' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transactions.findOne(id, user);
  }

  @Patch(':id/validate')
  @Roles(Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({
    summary: 'Valider une operation en attente',
    description: 'Emet le bordereau. Un operateur ne peut pas valider sa propre saisie.',
  })
  validate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transactions.validate(id, dto, user);
  }

  @Patch(':id/reject')
  @Roles(Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({ summary: 'Rejeter une operation suspecte (motif obligatoire)' })
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transactions.reject(id, dto, user);
  }

  @Patch(':id/cancel')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Annuler une operation validee',
    description:
      'Reservee a l\'administrateur : le bordereau est deja remis au client. ' +
      'L\'operation est marquee ANNULEE, jamais supprimee.',
  })
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transactions.cancel(id, dto, user);
  }
}
