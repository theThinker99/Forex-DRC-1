import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { IsDefined, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { SettingsService } from './settings.service';

class UpdateSettingDto {
  @ApiProperty({
    description: 'Nouvelle valeur du parametre (objet JSON).',
    example: { enabled: false, defaultRole: 'CABISTE' },
  })
  @IsDefined({ message: 'La valeur est obligatoire.' })
  @IsObject({ message: 'La valeur doit etre un objet JSON.' })
  value!: Prisma.InputJsonValue;
}

@ApiTags('Parametres')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * ADMIN uniquement : le cahier des charges exclut explicitement le
   * superviseur des parametres systeme critiques, et la BCC est en lecture
   * seule sur les operations, pas sur la configuration du bureau.
   */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lister les parametres systeme et leurs valeurs effectives' })
  all() {
    return this.settings.all();
  }

  @Put(':key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un parametre systeme' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.set(key, dto.value, user);
  }
}
