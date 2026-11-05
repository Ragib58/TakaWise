import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LedgerService } from './ledger.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [LedgerService, OutboxService, IdempotencyService],
  exports: [LedgerService, OutboxService, IdempotencyService],
})
export class LedgerModule {}
