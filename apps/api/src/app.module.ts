import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { SequenceModule } from './common/sequences/sequence.module';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ReadOnlyGuard } from './common/guards/read-only.guard';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AgenciesModule } from './agencies/agencies.module';
import { ClientsModule } from './clients/clients.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AlertsModule } from './alerts/alerts.module';
import { StatsModule } from './stats/stats.module';
import { SettingsModule } from './settings/settings.module';
import { CashModule } from './cash/cash.module';
import { StorageModule } from './storage/storage.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Le .env vit a la racine du monorepo : une seule source de verite
      // pour l'API et le frontend.
      envFilePath: ['../../.env', '.env'],
      cache: true,
    }),
    ThrottlerModule.forRoot([
      { name: 'court', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),
    PrismaModule,
    SequenceModule,
    AuditModule,
    StorageModule,
    AuthModule,
    UsersModule,
    AgenciesModule,
    ClientsModule,
    ExchangeRatesModule,
    TransactionsModule,
    ReceiptsModule,
    AttachmentsModule,
    AlertsModule,
    StatsModule,
    SettingsModule,
    CashModule,
  ],
  controllers: [HealthController],
  providers: [
    // L'ordre compte : authentification, puis lecture seule, puis roles.
    // ReadOnlyGuard avant RolesGuard pour que la BCC recoive un message
    // explicite sur son mandat plutot qu'un "role insuffisant" trompeur.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
