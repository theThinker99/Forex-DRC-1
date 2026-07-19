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
import { resolveAgencyFilter } from '../common/scope/agency-scope';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  QueryUsersDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './dto/user.dto';

@ApiTags('Utilisateurs')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Creer un utilisateur',
    description:
      'Le role est fixe ici et nulle part ailleurs : une connexion Google ne peut ni le definir ni le modifier.',
  })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.users.create(dto, user);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lister les utilisateurs' })
  findAll(@Query() query: QueryUsersDto) {
    return this.users.findAll(query);
  }

  /**
   * Liste des cabistes, necessaire aux filtres de la BCC et du superviseur.
   * Le perimetre est resserre automatiquement pour les roles cloisonnes.
   */
  @Get('operators')
  @Roles(Role.ADMIN, Role.BCC, Role.SUPERVISEUR)
  @ApiOperation({ summary: 'Lister les cabistes (pour les filtres)' })
  operators(
    @CurrentUser() user: AuthenticatedUser,
    @Query('agencyId') agencyId?: string,
  ) {
    return this.users.operators(resolveAgencyFilter(user, agencyId));
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Detail d\'un utilisateur' })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un utilisateur' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.update(id, dto, user);
  }

  @Post(':id/reset-password')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Reinitialiser le mot de passe d\'un utilisateur',
    description: 'Ferme toutes les sessions du compte cible.',
  })
  resetPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Archiver un utilisateur',
    description:
      'Suppression logique : le compte est archive et ses sessions fermees. ' +
      'Son historique d\'operations reste intact, il fait partie de la piste d\'audit.',
  })
  archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.archive(id, user);
  }
}
