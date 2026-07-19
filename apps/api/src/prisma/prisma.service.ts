import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion PostgreSQL etablie');
  }

  /**
   * Ferme proprement le pool quand le process recoit SIGTERM/SIGINT,
   * pour ne pas laisser de transaction en cours pendant un redeploiement.
   */
  enableShutdownHooks(app: INestApplication): void {
    const close = async () => {
      await app.close();
    };
    process.on('beforeExit', close);
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  }
}
