import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: 'Agence a analyser. Ignoree pour les roles cloisonnes, qui voient la leur.',
  })
  @IsUUID('4')
  @IsOptional()
  agencyId?: string;

  @ApiPropertyOptional({ example: '2026-07-01', description: 'Debut de periode (incluse).' })
  @IsISO8601({}, { message: 'dateFrom doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Fin de periode (incluse).' })
  @IsISO8601({}, { message: 'dateTo doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateTo?: string;
}
