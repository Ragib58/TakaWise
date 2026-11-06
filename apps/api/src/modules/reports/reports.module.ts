import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { ExportService } from './export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Phase 6: dashboard overview, reports and CSV export (read-only). */
@Module({
  imports: [TransactionsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExportService],
})
export class ReportsModule {}
