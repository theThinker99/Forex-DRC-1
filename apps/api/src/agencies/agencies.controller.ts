import {
  Body,
  Controller,
  Delete,
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
import { AgenciesService } from './agencies.service';
import {
  CreateAgencyDto,
  QueryAgenciesDto,
  UpdateAgencyDto,
} from './dto/agency.dto';

@ApiTags('Agences')
@ApiBearerAuth('access-token')
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Creer une agence' })
  create(@Body() dto: CreateAgencyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agencies.create(dto, user);
  }

  /** Lecture ouverte a tous les roles : la BCC filtre par agence, le cabiste
   *  a besoin du libelle de la sienne sur ses ecrans. */
  @Get()
  @ApiOperation({ summary: 'Lister les agences' })
  findAll(@Query() query: QueryAgenciesDto) {
    return this.agencies.findAll(query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Agences actives, format liste deroulante' })
  options() {
    return this.agencies.options();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d\'une agence' })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.agencies.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier une agence' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAgencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agencies.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Fermer une agence',
    description:
      'Fermeture logique : l\'agence passe au statut FERMEE et reste consultable. ' +
      'Aucune donnee historique n\'est supprimee.',
  })
  close(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agencies.close(id, user);
  }
}
