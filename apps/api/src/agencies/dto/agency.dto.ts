import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { AgencyStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAgencyDto {
  @ApiProperty({
    example: 'GOM',
    description:
      'Code court, en majuscules. Sert de prefixe aux references de transaction : immuable une fois cree.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(2, { message: 'Le code doit contenir au moins 2 caracteres.' })
  @MaxLength(8, { message: 'Le code ne peut pas depasser 8 caracteres.' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Le code ne peut contenir que des lettres majuscules et des chiffres.',
  })
  code!: string;

  @ApiProperty({ example: 'Bureau de change Goma Centre' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'Goma' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ example: 'Karisimbi' })
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  @IsOptional()
  commune?: string;

  @ApiPropertyOptional({ example: '12, avenue du Lac' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: '+243810000000' })
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9\s-]{6,32}$/, { message: 'Numero de telephone invalide.' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'BCC/CHG/2026/0142', description: 'Numero d\'agrement BCC' })
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  licenseNo?: string;
}

/**
 * `code` est volontairement exclu : il est fige dans les references de
 * transaction deja emises. Le renommer casserait la piste d'audit.
 */
export class UpdateAgencyDto extends PartialType(
  OmitType(CreateAgencyDto, ['code'] as const),
) {
  @ApiPropertyOptional({ enum: AgencyStatus })
  @IsEnum(AgencyStatus, { message: 'Statut d\'agence invalide.' })
  @IsOptional()
  status?: AgencyStatus;
}

export class QueryAgenciesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Recherche sur le code, le nom ou la ville' })
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: AgencyStatus })
  @IsEnum(AgencyStatus)
  @IsOptional()
  status?: AgencyStatus;
}
