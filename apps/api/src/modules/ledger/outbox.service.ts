import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

export type OutboxEventType =
  | 'account.created'
  | 'transaction.posted'
  | 'transaction.reversed'
  | 'transfer.posted'
  | 'transfer.reversed';

/**
 * Transactional outbox (ADR-014): the event row commits with the business
 * change, so consumers never see events for rolled-back postings. Payloads hold
 * ids only — no amounts or notes. The publisher/worker arrives in Phase 5.
 */
@Injectable()
export class OutboxService {
  async enqueue(
    tx: Prisma.TransactionClient,
    type: OutboxEventType,
    userId: string,
    payload: Record<string, string>,
  ): Promise<void> {
    await tx.outboxEvent.create({ data: { type, userId, payload } });
  }
}
