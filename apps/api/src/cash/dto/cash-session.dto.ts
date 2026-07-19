import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Les soldes sont un dictionnaire devise -> montant (chaine), ex.
 * { "USD": "12000", "CDF": "250000" }. La validation fine (devises connues,
 * montants positifs) est faite dans le service, comme pour les parametres.
 */
export class OpenCashSessionDto {
  @ApiProperty({
    example: { USD: '12000.00', CDF: '250000.00' },
    description: 'Fonds detenus par le cabiste en debut de journee, par devise.',
  })
  @IsObject({ message: 'Les fonds doivent etre un objet devise -> montant.' })
  balances!: Record<string, string>;

  @ApiPropertyOptional({ description: 'Note libre (facultative).' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}

export class CloseCashSessionDto {
  @ApiPropertyOptional({
    example: { USD: '11500.00', CDF: '272000.00' },
    description: 'Montants physiquement comptes a la cloture, par devise (facultatif).',
  })
  @IsObject({ message: 'Les montants comptes doivent etre un objet devise -> montant.' })
  @IsOptional()
  countedBalances?: Record<string, string>;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}

export class QueryCashSessionsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filtrer par cabiste (ADMIN/SUPERVISEUR).' })
  @IsUUID('4')
  @IsOptional()
  operatorId?: string;

  @ApiPropertyOptional({ description: 'Filtrer par agence (ADMIN/BCC).' })
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsISO8601({}, { message: 'dateFrom doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsISO8601({}, { message: 'dateTo doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateTo?: string;
}
