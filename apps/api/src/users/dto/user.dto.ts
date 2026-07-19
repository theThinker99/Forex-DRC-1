import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PASSWORD_MESSAGE, PASSWORD_PATTERN } from '../../auth/dto/auth.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({ example: 'Kabila Mwamba' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Le nom complet doit contenir au moins 3 caracteres.' })
  @MaxLength(160)
  fullName!: string;

  @ApiProperty({ example: 'cabiste.goma@change-rdc.cd' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  @IsEmail({}, { message: 'Adresse email invalide.' })
  @MaxLength(190)
  email!: string;

  @ApiPropertyOptional({
    description:
      'Mot de passe initial. Omettre pour un compte destine a la connexion Google uniquement.',
  })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  @IsOptional()
  password?: string;

  @ApiProperty({ enum: Role, description: 'Determine les droits. Jamais issu de Google.' })
  @IsEnum(Role, { message: `Le role doit valoir ${Object.values(Role).join(', ')}.` })
  role!: Role;

  @ApiPropertyOptional({
    description:
      'Agence de rattachement. Obligatoire pour CABISTE et SUPERVISEUR, interdite pour ADMIN et BCC.',
  })
  @IsUUID('4', { message: 'L\'agence doit etre un UUID valide.' })
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({ example: '+243990000000' })
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9\s-]{6,32}$/, { message: 'Numero de telephone invalide.' })
  @IsOptional()
  phone?: string;
}

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus, { message: 'Statut invalide.' })
  @IsOptional()
  status?: UserStatus;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Nouveau mot de passe attribue par l\'administrateur.' })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class QueryUsersDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Recherche sur le nom ou l\'email' })
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;
}
