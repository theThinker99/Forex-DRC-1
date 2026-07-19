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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IdDocumentType, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { ClientsService } from './clients.service';
import {
  CorrectIdentityDto,
  CreateClientDto,
  QueryClientsDto,
  UpdateClientDto,
} from './dto/client.dto';

@ApiTags('Clients')
@ApiBearerAuth('access-token')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({ summary: 'Enregistrer un client' })
  create(@Body() dto: CreateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.create(dto, user);
  }

  /**
   * Lecture ouverte a tous les roles authentifies ; le perimetre est resserre
   * dans le service (agence pour le cabiste et le superviseur, national pour
   * l'ADMIN et la BCC).
   */
  @Get()
  @ApiOperation({ summary: 'Rechercher des clients' })
  findAll(@Query() query: QueryClientsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.findAll(query, user);
  }

  @Get('by-document')
  @ApiOperation({
    summary: 'Retrouver un client par sa piece d\'identite',
    description: 'Renvoie null si aucun client ne correspond : ce n\'est pas une erreur.',
  })
  @ApiQuery({ name: 'idDocumentType', enum: IdDocumentType })
  @ApiQuery({ name: 'idDocumentNo', type: String })
  findByDocument(
    @Query('idDocumentType') idDocumentType: IdDocumentType,
    @Query('idDocumentNo') idDocumentNo: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.findByDocument(idDocumentType, idDocumentNo, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d\'un client' })
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.findOne(id, user);
  }

  @Patch(':id')
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({ summary: 'Modifier les coordonnees d\'un client' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.update(id, dto, user);
  }

  @Patch(':id/identity')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Corriger la piece d\'identite d\'un client',
    description:
      'Reservee a l\'administrateur et journalisee avec son motif : ce numero figure ' +
      'sur des bordereaux deja remis aux clients.',
  })
  correctIdentity(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CorrectIdentityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.correctIdentity(id, dto, user);
  }
}
