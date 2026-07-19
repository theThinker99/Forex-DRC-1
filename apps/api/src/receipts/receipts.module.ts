import { Module } from '@nestjs/common';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptPdfService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
