import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, TransactionStatus, TransactionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Les montants transitent en chaine pour preserver la precision decimale. */
const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,4})?$/;
const AMOUNT_MESSAGE =
  'Montant invalide : nombre positif avec au plus 4 decimales (ex. "1500.00").';

const RATE_PATTERN = /^\d{1,14}(\.\d{1,6})?$/;

const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

export class CreateTransactionDto {
  @ApiProperty({ description: 'Client identifie, deja enregistre avec sa piece.' })
  @IsUUID('4', { message: 'Le client doit etre un UUID valide.' })
  clientId!: string;

  @ApiProperty({
    enum: TransactionType,
    description:
      'ACHAT : le bureau achete la devise etrangere (le client remet des USD/EUR). ' +
      'VENTE : le bureau vend la devise etrangere (le client remet des CDF).',
  })
  @IsEnum(TransactionType, { message: 'Le sens doit valoir ACHAT ou VENTE.' })
  type!: TransactionType;

  @ApiProperty({
    enum: [Currency.USD, Currency.EUR],
    description: 'Devise etrangere de l\'operation. La contrepartie est toujours le CDF.',
  })
  @IsEnum(Currency, { message: 'Devise invalide.' })
  foreignCurrency!: Currency;

  @ApiProperty({
    example: '500.00',
    description:
      'Montant remis par le client, dans la devise qu\'il remet ' +
      '(devise etrangere si ACHAT, CDF si VENTE).',
  })
  @Transform(asString)
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  fromAmount!: string;

  @ApiPropertyOptional({
    example: '0.00',
    description: 'Commission prelevee, dans la devise remise au client.',
  })
  @Transform(asString)
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  @IsOptional()
  commission?: string;

  @ApiPropertyOptional({
    example: '2760.000000',
    description:
      'Taux derogatoire. Reserve a l\'ADMIN et au SUPERVISEUR, exige un motif, ' +
      'et declenche systematiquement une alerte de controle.',
  })
  @Transform(asString)
  @Matches(RATE_PATTERN, { message: 'Taux invalide.' })
  @IsOptional()
  rateOverride?: string;

  @ApiPropertyOptional({ description: 'Motif du taux derogatoire. Obligatoire si rateOverride.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'Le motif doit contenir au moins 10 caracteres.' })
  @MaxLength(500)
  @IsOptional()
  rateOverrideReason?: string;

  @ApiPropertyOptional({
    description: 'Horodatage reel au guichet. Maintenant par defaut.',
    example: '2026-07-17T10:35:00.000Z',
  })
  @IsISO8601({ strict: true }, { message: 'Date invalide (format ISO 8601 attendu).' })
  @IsOptional()
  occurredAt?: string;
}

export class ReviewTransactionDto {
  @ApiPropertyOptional({
    description:
      'Commentaire du superviseur. Obligatoire pour un rejet : le cabiste doit savoir quoi corriger.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Le commentaire doit contenir au moins 5 caracteres.' })
  @MaxLength(1000)
  @IsOptional()
  comment?: string;
}

export class CancelTransactionDto {
  @ApiProperty({ description: 'Motif de l\'annulation. Journalise.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'Le motif doit contenir au moins 10 caracteres.' })
  @MaxLength(500)
  reason!: string;
}

export class QueryTransactionsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Recherche sur la reference ou le nom du client' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsISO8601({}, { message: 'dateFrom doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsISO8601({}, { message: 'dateTo doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filtrer par cabiste' })
  @IsUUID('4')
  @IsOptional()
  operatorId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par agence' })
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  clientId?: string;

  @ApiPropertyOptional({ enum: Currency, description: 'Devise, en entree ou en sortie' })
  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsEnum(TransactionStatus)
  @IsOptional()
  status?: TransactionStatus;

  @ApiPropertyOptional({
    example: '100',
    description: 'Contre-valeur USD minimale. Compare toutes devises sur la meme echelle.',
  })
  @Transform(asString)
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  @IsOptional()
  minUsd?: string;

  @ApiPropertyOptional({ example: '10000', description: 'Contre-valeur USD maximale.' })
  @Transform(asString)
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  @IsOptional()
  maxUsd?: string;
}
