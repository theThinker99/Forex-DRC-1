import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Les montants et taux transitent en chaine, jamais en number : un
 * `number` JavaScript perd de la precision au-dela de 2^53 et introduit des
 * artefacts binaires (0.1 + 0.2). Ils sont convertis en Decimal cote service.
 */
const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,6})?$/;
const DECIMAL_MESSAGE =
  'Valeur numerique invalide : utilisez un nombre positif avec au plus 6 decimales (ex. "2750.500000").';

const asString = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

export class CreateExchangeRateDto {
  @ApiProperty({
    enum: Currency,
    example: Currency.USD,
    description: 'Devise etrangere de la paire. Ne peut pas etre le CDF.',
  })
  @IsEnum(Currency, { message: 'Devise invalide.' })
  baseCurrency!: Currency;

  @ApiProperty({
    enum: Currency,
    example: Currency.CDF,
    description: 'Devise de cotation. Le CDF dans la quasi-totalite des cas.',
  })
  @IsEnum(Currency, { message: 'Devise invalide.' })
  quoteCurrency!: Currency;

  @ApiProperty({
    example: '2750.000000',
    description: 'Prix auquel le bureau ACHETE 1 unite de la devise etrangere.',
  })
  @Transform(asString)
  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  buyRate!: string;

  @ApiProperty({
    example: '2800.000000',
    description: 'Prix auquel le bureau VEND 1 unite de la devise etrangere.',
  })
  @Transform(asString)
  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  sellRate!: string;

  @ApiPropertyOptional({
    example: '2775.000000',
    description: 'Taux de reference BCC du jour, utilise pour controler l\'ecart.',
  })
  @Transform(asString)
  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  @IsOptional()
  referenceRate?: string;

  @ApiPropertyOptional({
    description: 'Agence concernee. Omettre pour un taux national applicable partout.',
  })
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({
    description: 'Date de prise d\'effet. Maintenant par defaut.',
    example: '2026-07-17T08:00:00.000Z',
  })
  @IsISO8601({ strict: true }, { message: 'Date invalide (format ISO 8601 attendu).' })
  @IsOptional()
  effectiveFrom?: string;
}

export class QueryExchangeRatesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: Currency })
  @IsEnum(Currency)
  @IsOptional()
  baseCurrency?: Currency;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({
    description: 'true pour ne renvoyer que les taux actuellement en vigueur.',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  activeOnly?: boolean;
}
