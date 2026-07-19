import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Sante')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sonde de vivacite pour l'orchestrateur (Docker healthcheck, k8s probe).
   * Publique et non journalisee : elle est appelee en continu.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Etat de sante de l\'API et de la base' })
  async check() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'indisponible';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degrade',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
