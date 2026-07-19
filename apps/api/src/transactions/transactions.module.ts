import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [ExchangeRatesModule, AlertsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
