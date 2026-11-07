import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InvestmentsService } from './investments.service';
import { LoansService } from './loans.service';
import { NetWorthService } from './net-worth.service';
import { InvestmentsController, LoansController, NetWorthController } from './wealth.controllers';

/** Phase 8: investments, loans, net-worth items and net worth (ADR-022/023). */
@Module({
  imports: [AccountsModule, TransactionsModule],
  controllers: [InvestmentsController, LoansController, NetWorthController],
  providers: [InvestmentsService, LoansService, NetWorthService],
})
export class WealthModule {}
