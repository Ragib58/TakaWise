import { Module } from '@nestjs/common';
import { TransactionsController, TransfersController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [TransactionsController, TransfersController],
  providers: [TransactionsService, TransfersService],
})
export class TransactionsModule {}
