import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, Role } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryAuditDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Identifiant de l\'auteur de l\'action' })
  @IsUUID('4', { message: 'actorId doit etre un UUID valide.' })
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsEnum(Role, { message: 'Role inconnu.' })
  @IsOptional()
  actorRole?: Role;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsEnum(AuditAction, { message: 'Action inconnue.' })
  @IsOptional()
  action?: AuditAction;

  @ApiPropertyOptional({ example: 'Transaction' })
  @IsString()
  @MaxLength(60)
  @IsOptional()
  entity?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  @IsOptional()
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-07-01', description: 'Date de debut (incluse)' })
  @IsISO8601({}, { message: 'dateFrom doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Date de fin (incluse)' })
  @IsISO8601({}, { message: 'dateTo doit etre une date ISO (AAAA-MM-JJ).' })
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Recherche sur l\'email de l\'auteur ou l\'identifiant d\'entite' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;
}
