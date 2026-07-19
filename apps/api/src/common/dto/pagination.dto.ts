import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Pagination serveur. `limit` est plafonne a 100 : sans plafond, un
 * ?limit=1000000 sur transactions ferait tomber l'API.
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page demandee (1-indexee)' })
  @Type(() => Number)
  @IsInt({ message: 'La page doit etre un entier.' })
  @Min(1, { message: 'La page doit etre superieure ou egale a 1.' })
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt({ message: 'La taille de page doit etre un entier.' })
  @Min(1)
  @Max(100, { message: 'La taille de page ne peut pas depasser 100.' })
  @IsOptional()
  limit: number = 25;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
}
