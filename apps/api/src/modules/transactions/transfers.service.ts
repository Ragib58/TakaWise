import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateTransferRequest,
  ListTransfersQuery,
  ReverseRequest,
  TransferResponse,
} from '@takawise/contracts';
import { Paginated } from '../../common/envelope/paginated';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { transferLines } from '../../domain/ledger/posting-templates';
import { parsePositiveMoney, toMoneyString } from '../../domain/money/money';
import { dateOnly } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentResult } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../ledger/outbox.service';
import {
  assertPostable,
  conflict,
  effectiveDateFor,
  notFound,
  userTimeZone,
} from './posting-rules';
import { toTransferResponse, transferInclude } from './transactions.mapper';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * TRX-02/TRX-03: moves value between two of the user's accounts in one
   * currency. Excluded from income/expense because it never touches those
   * ledger accounts. Paying a credit card from a bank account is a transfer.
   */
  create(
    userId: string,
    input: CreateTransferRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<TransferResponse>> {
    const amount = parsePositiveMoney(input.amount);
    return this.idempotency.execute({
      userId,
      key: idempotencyKey,
      scope: 'POST /transfers',
      request: input,
      responseStatus: HttpStatus.CREATED,
      run: async (tx) => {
        const load = (id: string) =>
          tx.financialAccount.findFirst({
            where: { id, userId },
            include: { ledgerAccount: true },
          });
        const source = await load(input.sourceAccountId);
        assertPostable(source, 'sourceAccountId', input.currency);
        const destination = await load(input.destinationAccountId);
        assertPostable(destination, 'destinationAccountId', input.currency);

        const occurredAt = new Date(input.occurredAt);
        const effectiveDate = effectiveDateFor({
          occurredAt,
          timeZone: await userTimeZone(tx, userId),
          openingDates: [
            { field: 'occurredAt', openingDate: source.openingDate },
            { field: 'occurredAt', openingDate: destination.openingDate },
          ],
        });

        const journal = await this.ledger.post(tx, {
          userId,
          kind: 'TRANSFER',
          currency: input.currency,
          effectiveDate,
          lines: transferLines(source.ledgerAccount.id, destination.ledgerAccount.id, amount),
        });
        const transfer = await tx.transfer.create({
          data: {
            userId,
            journalEntryId: journal.id,
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            amount: toMoneyString(amount),
            currency: input.currency,
            occurredAt,
            effectiveDate: dateOnly(effectiveDate),
            description: input.description || null,
          },
          include: transferInclude,
        });

        await this.audit.record(
          { action: 'transfer.posted', userId, entityType: 'transfer', entityId: transfer.id },
          client,
          tx,
        );
        await this.outbox.enqueue(tx, 'transfer.posted', userId, { transferId: transfer.id });
        return toTransferResponse(transfer);
      },
    });
  }

  async list(userId: string, query: ListTransfersQuery): Promise<Paginated<TransferResponse>> {
    const where: Prisma.TransferWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.accountId
        ? { OR: [{ sourceAccountId: query.accountId }, { destinationAccountId: query.accountId }] }
        : {}),
      ...(query.from || query.to
        ? {
            effectiveDate: {
              ...(query.from ? { gte: dateOnly(query.from) } : {}),
              ...(query.to ? { lte: dateOnly(query.to) } : {}),
            },
          }
        : {}),
    };
    // Separate, parallel reads: no transaction holding a pooled connection.
    const [total, rows] = await Promise.all([
      this.prisma.transfer.count({ where }),
      this.prisma.transfer.findMany({
        where,
        include: transferInclude,
        orderBy: [{ effectiveDate: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return new Paginated(rows.map(toTransferResponse), query.page, query.pageSize, total);
  }

  async get(userId: string, id: string): Promise<TransferResponse> {
    const transfer = await this.prisma.transfer.findFirst({
      where: { id, userId },
      include: transferInclude,
    });
    if (!transfer) throw notFound('Transfer');
    return toTransferResponse(transfer);
  }

  async reverse(
    userId: string,
    id: string,
    input: ReverseRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<TransferResponse>> {
    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /transfers/:id/reverse',
        request: { id, ...input },
        responseStatus: HttpStatus.OK,
        run: async (tx) => {
          const original = await tx.transfer.findFirst({ where: { id, userId } });
          if (!original) throw notFound('Transfer');
          if (original.status !== 'POSTED')
            throw conflict('This transfer has already been reversed.');

          const reversal = await this.ledger.reverse(
            tx,
            userId,
            original.journalEntryId,
            input.reason,
          );
          const updated = await tx.transfer.update({
            where: { id: original.id },
            data: {
              status: 'REVERSED',
              reversalJournalEntryId: reversal.id,
              reversedAt: new Date(),
            },
            include: transferInclude,
          });
          await this.audit.record(
            { action: 'transfer.reversed', userId, entityType: 'transfer', entityId: original.id },
            client,
            tx,
          );
          await this.outbox.enqueue(tx, 'transfer.reversed', userId, { transferId: original.id });
          return toTransferResponse(updated);
        },
      });
    } catch (error) {
      if (uniqueViolation(error)?.includes('reverses_id')) {
        throw conflict('This transfer has already been reversed.');
      }
      throw error;
    }
  }
}
