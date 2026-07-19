import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { IdDocumentType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateClientDto {
  @ApiProperty({ example: 'Jean' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Le prenom doit contenir au moins 2 caracteres.' })
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Mukendi' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caracteres.' })
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ enum: IdDocumentType, example: IdDocumentType.CARTE_ELECTEUR })
  @IsEnum(IdDocumentType, { message: 'Type de piece d\'identite invalide.' })
  idDocumentType!: IdDocumentType;

  @ApiProperty({
    example: '19-A12345-67890',
    description: 'Numero de la piece. Normalise en majuscules pour eviter les doublons.',
  })
  @Transform(upperTrim)
  @IsString()
  @MinLength(4, { message: 'Le numero de piece doit contenir au moins 4 caracteres.' })
  @MaxLength(64)
  @Matches(/^[A-Z0-9\-/ ]+$/, {
    message: 'Le numero de piece ne peut contenir que lettres, chiffres, tirets et barres obliques.',
  })
  idDocumentNo!: string;

  @ApiPropertyOptional({ example: 'Congolaise (RDC)' })
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  @IsOptional()
  nationality?: string;

  @ApiPropertyOptional({ example: '1985-04-12' })
  @IsDateString({}, { message: 'La date de naissance doit etre au format AAAA-MM-JJ.' })
  @IsOptional()
  birthDate?: string;

  @ApiPropertyOptional({ example: '+243820000000' })
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9\s-]{6,32}$/, { message: 'Numero de telephone invalide.' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Avenue Kalemie, Goma' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: 'Personne politiquement exposee : declenche une vigilance renforcee.',
    default: false,
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isPep?: boolean;

  @ApiPropertyOptional({ description: 'Agence de rattachement. Deduite du cabiste si omise.' })
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

/**
 * `idDocumentType`, `idDocumentNo` et `agencyId` sont exclus : les deux
 * premiers identifient le client au sens KYC, le troisieme le deplacerait
 * hors du perimetre de son cabiste. Une correction de piece passe par
 * l'administrateur, via une route dediee qui laisse une trace explicite.
 */
export class UpdateClientDto extends PartialType(
  OmitType(CreateClientDto, ['idDocumentType', 'idDocumentNo', 'agencyId'] as const),
) {}

/** Correction d'identite, reservee a l'ADMIN. */
export class CorrectIdentityDto {
  @ApiProperty({ enum: IdDocumentType })
  @IsEnum(IdDocumentType, { message: 'Type de piece d\'identite invalide.' })
  idDocumentType!: IdDocumentType;

  @ApiProperty({ example: '19-A12345-67890' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Z0-9\-/ ]+$/, {
    message: 'Le numero de piece ne peut contenir que lettres, chiffres, tirets et barres obliques.',
  })
  idDocumentNo!: string;

  @ApiProperty({
    description: 'Motif de la correction. Obligatoire : il est journalise.',
    example: 'Erreur de saisie du numero, corrige sur presentation de la piece originale.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Le motif doit contenir au moins 10 caracteres.' })
  @MaxLength(500)
  reason!: string;
}

export class QueryClientsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Recherche sur le nom ou le numero de piece' })
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({ enum: IdDocumentType })
  @IsEnum(IdDocumentType)
  @IsOptional()
  idDocumentType?: IdDocumentType;
}
