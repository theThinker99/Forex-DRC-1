import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertSeverity, AlertStatus, AlertType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryAlertsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AlertStatus })
  @IsEnum(AlertStatus)
  @IsOptional()
  status?: AlertStatus;

  @ApiPropertyOptional({ enum: AlertSeverity })
  @IsEnum(AlertSeverity)
  @IsOptional()
  severity?: AlertSeverity;

  @ApiPropertyOptional({ enum: AlertType })
  @IsEnum(AlertType)
  @IsOptional()
  type?: AlertType;

  @ApiPropertyOptional()
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

export class ResolveAlertDto {
  @ApiProperty({
    enum: [AlertStatus.EN_REVUE, AlertStatus.RESOLUE, AlertStatus.IGNOREE],
    description:
      'EN_REVUE : prise en charge. RESOLUE : traitee. IGNOREE : faux positif assume.',
  })
  @IsIn([AlertStatus.EN_REVUE, AlertStatus.RESOLUE, AlertStatus.IGNOREE], {
    message: 'Le statut doit valoir EN_REVUE, RESOLUE ou IGNOREE.',
  })
  status!: AlertStatus;

  @ApiProperty({
    description:
      'Explication du traitement. Obligatoire : une alerte cloturee sans motif ne vaut rien lors d\'un controle.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'La resolution doit contenir au moins 10 caracteres.' })
  @MaxLength(1000)
  resolution!: string;
}
