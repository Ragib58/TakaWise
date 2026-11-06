import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateTransactionRequest,
  ListTransactionsQuery,
  PostedTransactionResponse,
  ReverseRequest,
  TransactionResponse,
} from '@takawise/contracts';
import { Paginated } from '../../common/envelope/paginated';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { expenseLines, incomeLines } from '../../domain/ledger/posting-templates';
import { parsePositiveMoney, toMoneyString, ZERO } from '../../domain/money/money';
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
  invalid,
  notFound,
  userTimeZone,
} from './posting-rules';
import { toTransactionResponse, transactionInclude } from './transactions.mapper';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** TRX-01: posts an income/expense and its balanced journal atomically. */
  create(
    userId: string,
    input: CreateTransactionRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<PostedTransactionResponse>> {
    const amount = parsePositiveMoney(input.amount);
    return this.idempotency.execute({
      userId,
      key: idempotencyKey,
      scope: 'POST /transactions',
      request: input,
      responseStatus: HttpStatus.CREATED,
      run: async (tx) => {
        const account = await tx.financialAccount.findFirst({
          where: { id: input.accountId, userId },
          include: { ledgerAccount: true },
        });
        assertPostable(account, 'accountId', input.currency);
        await this.assertCategoryUsable(tx, userId, input.categoryId, input.type);

        const occurredAt = new Date(input.occurredAt);
        const effectiveDate = effectiveDateFor({
          occurredAt,
          timeZone: await userTimeZone(tx, userId),
          openingDates: [{ field: 'occurredAt', openingDate: account.openingDate }],
        });

        const accountLedgerId = account.ledgerAccount.id;
        const lines =
          input.type === 'INCOME'
            ? incomeLines(
                accountLedgerId,
                await this.ledger.systemAccountId(tx, userId, 'INCOME'),
                amount,
              )
            : expenseLines(
                await this.ledger.systemAccountId(tx, userId, 'EXPENSE'),
                accountLedgerId,
                amount,
              );

        const journal = await this.ledger.post(tx, {
          userId,
          kind: input.type,
          currency: input.currency,
          effectiveDate,
          lines,
        });
        const trx = await tx.transaction.create({
          data: {
            userId,
            journalEntryId: journal.id,
            type: input.type,
            amount: toMoneyString(amount),
            currency: input.currency,
            accountId: account.id,
            categoryId: input.categoryId,
            occurredAt,
            effectiveDate: dateOnly(effectiveDate),
            description: input.description || null,
          },
          include: transactionInclude,
        });

        await this.audit.record(
          { action: 'transaction.posted', userId, entityType: 'transaction', entityId: trx.id },
          client,
          tx,
        );
        await this.outbox.enqueue(tx, 'transaction.posted', userId, { transactionId: trx.id });

        const balances = await this.ledger.balances(tx, [account.ledgerAccount]);
        return {
          ...toTransactionResponse(trx),
          accountBalance: toMoneyString(balances.get(accountLedgerId) ?? ZERO),
        };
      },
    });
  }

  async list(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<Paginated<TransactionResponse>> {
    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.from || query.to
        ? {
            effectiveDate: {
              ...(query.from ? { gte: dateOnly(query.from) } : {}),
              ...(query.to ? { lte: dateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q ? { description: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    // Separate, parallel reads: no transaction holding a pooled connection.
    const [total, rows] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: [{ effectiveDate: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return new Paginated(rows.map(toTransactionResponse), query.page, query.pageSize, total);
  }

  async get(userId: string, id: string): Promise<TransactionResponse> {
    const trx = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: transactionInclude,
    });
    if (!trx) throw notFound('Transaction');
    return toTransactionResponse(trx);
  }

  /**
   * TRX-04: correction by compensating journal. The original stays in history,
   * marked REVERSED; budgets/reports exclude both (ADR-010).
   */
  async reverse(
    userId: string,
    id: string,
    input: ReverseRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<PostedTransactionResponse>> {
    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /transactions/:id/reverse',
        request: { id, ...input },
        responseStatus: HttpStatus.OK,
        run: async (tx) => {
          const original = await tx.transaction.findFirst({
            where: { id, userId },
            include: { account: { include: { ledgerAccount: true } } },
          });
          if (!original) throw notFound('Transaction');
          if (original.status !== 'POSTED')
            throw conflict('This transaction has already been reversed.');

          const reversal = await this.ledger.reverse(
            tx,
            userId,
            original.journalEntryId,
            input.reason,
          );
          const updated = await tx.transaction.update({
            where: { id: original.id },
            data: {
              status: 'REVERSED',
              reversalJournalEntryId: reversal.id,
              reversedAt: new Date(),
            },
            include: transactionInclude,
          });

          await this.audit.record(
            {
              action: 'transaction.reversed',
              userId,
              entityType: 'transaction',
              entityId: original.id,
              metadata: input.reason ? { hasReason: true } : undefined,
            },
            client,
            tx,
          );
          await this.outbox.enqueue(tx, 'transaction.reversed', userId, {
            transactionId: original.id,
          });

          const ledgerAccount = original.account.ledgerAccount!;
          const balances = await this.ledger.balances(tx, [ledgerAccount]);
          return {
            ...toTransactionResponse(updated),
            accountBalance: toMoneyString(balances.get(ledgerAccount.id) ?? ZERO),
          };
        },
      });
    } catch (error) {
      // A concurrent reversal won the race on journal_entries.reverses_id.
      if (uniqueViolation(error)?.includes('reverses_id')) {
        throw conflict('This transaction has already been reversed.');
      }
      throw error;
    }
  }

  /** CAT-01: system categories or the user's own, active, of the matching type. */
  private async assertCategoryUsable(
    tx: Prisma.TransactionClient,
    userId: string,
    categoryId: string,
    type: 'INCOME' | 'EXPENSE',
  ): Promise<void> {
    const category = await tx.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      select: { type: true, status: true },
    });
    if (!category) throw notFound('Category');
    if (category.status !== 'ACTIVE') throw conflict('This category is archived.');
    if (category.type !== type) {
      throw invalid([
        {
          field: 'categoryId',
          message: `Choose ${type === 'INCOME' ? 'an income' : 'an expense'} category`,
        },
      ]);
    }
  }
}
