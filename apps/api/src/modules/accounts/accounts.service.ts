import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AccountResponse,
  CreateAccountRequest,
  UpdateAccountRequest,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { ledgerClassForAccountType, normalBalanceFor } from '../../domain/ledger/ledger-rules';
import { openingBalanceLines } from '../../domain/ledger/posting-templates';
import { parseMoney, ZERO } from '../../domain/money/money';
import { dateOnly, localDateOf } from '../../domain/time/local-date';
import { invalid, userTimeZone } from '../transactions/posting-rules';
import { PrismaService } from '../../database/prisma.service';
import type { FinancialAccount, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentResult } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../ledger/outbox.service';
import { toAccountResponse } from './accounts.mapper';

type CreateAccountInput = Omit<CreateAccountRequest, 'currency' | 'openingBalance'> & {
  currency: string;
  openingBalance: string;
};

export function accountNotFound(): AppException {
  return new AppException('NOT_FOUND', 'Account not found.', HttpStatus.NOT_FOUND);
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** ACC-01/ACC-02: creates the account, its ledger account and the OPENING_BALANCE journal. */
  async create(
    userId: string,
    input: CreateAccountInput,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<AccountResponse>> {
    const openingBalance = parseMoney(input.openingBalance);
    const cls = ledgerClassForAccountType(input.type);

    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /accounts',
        request: input,
        responseStatus: HttpStatus.CREATED,
        run: async (tx) => {
          const today = localDateOf(new Date(), await userTimeZone(tx, userId));
          if (input.openingDate > today) {
            throw invalid([
              { field: 'openingDate', message: 'The opening date cannot be in the future' },
            ]);
          }
          const account = await tx.financialAccount.create({
            data: {
              userId,
              name: input.name,
              type: input.type,
              currency: input.currency,
              openingDate: dateOnly(input.openingDate),
              openingBalance: input.openingBalance,
              institutionName: input.institutionName ?? null,
              creditLimit: input.creditLimit ?? null,
              ledgerAccount: {
                create: { class: cls, normalBalance: normalBalanceFor(cls), name: input.name },
              },
            },
            include: { ledgerAccount: true },
          });
          const ledgerAccount = account.ledgerAccount!;

          if (!openingBalance.isZero()) {
            await this.ledger.post(tx, {
              userId,
              kind: 'OPENING_BALANCE',
              currency: account.currency,
              effectiveDate: input.openingDate,
              memo: 'Opening balance',
              lines: openingBalanceLines({
                accountClass: cls,
                accountLedgerId: ledgerAccount.id,
                openingEquityLedgerId: await this.ledger.systemAccountId(
                  tx,
                  userId,
                  'EQUITY_OPENING_BALANCE',
                ),
                amount: openingBalance,
              }),
            });
          }

          await this.audit.record(
            {
              action: 'account.created',
              userId,
              entityType: 'financial_account',
              entityId: account.id,
            },
            client,
            tx,
          );
          await this.outbox.enqueue(tx, 'account.created', userId, { accountId: account.id });
          return toAccountResponse(account, openingBalance);
        },
      });
    } catch (error) {
      throw mapAccountConflict(error);
    }
  }

  async list(userId: string, status: 'ACTIVE' | 'ARCHIVED' | 'ALL'): Promise<AccountResponse[]> {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { userId, ...(status === 'ALL' ? {} : { status }) },
      include: { ledgerAccount: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return this.withBalances(accounts);
  }

  async get(userId: string, id: string): Promise<AccountResponse> {
    const account = await this.findOwned(this.prisma, userId, id);
    const [response] = await this.withBalances([account]);
    return response!;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateAccountRequest,
    client: ClientContext,
  ): Promise<AccountResponse> {
    const account = await this.findOwned(this.prisma, userId, id);
    const settingCreditLimit = input.creditLimit !== undefined && input.creditLimit !== null;
    if (settingCreditLimit && account.type !== 'CREDIT_CARD_TRACKING') {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'creditLimit', message: 'Only credit-card accounts have a credit limit' }],
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.financialAccount.update({
          where: { id: account.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.institutionName !== undefined
              ? { institutionName: input.institutionName }
              : {}),
            ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'account.updated',
            userId,
            entityType: 'financial_account',
            entityId: account.id,
            metadata: { fields: Object.keys(input) },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      throw mapAccountConflict(error);
    }
    return this.get(userId, id);
  }

  /**
   * Archived accounts keep their history and balance but accept no new postings.
   * Archiving is reversible (restore) because nothing is deleted.
   */
  async setArchived(
    userId: string,
    id: string,
    archived: boolean,
    client: ClientContext,
  ): Promise<AccountResponse> {
    const account = await this.findOwned(this.prisma, userId, id);
    if ((account.status === 'ARCHIVED') !== archived) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.financialAccount.update({
            where: { id: account.id },
            data: archived
              ? { status: 'ARCHIVED', archivedAt: new Date() }
              : { status: 'ACTIVE', archivedAt: null },
          });
          await this.audit.record(
            {
              action: archived ? 'account.archived' : 'account.restored',
              userId,
              entityType: 'financial_account',
              entityId: account.id,
            },
            client,
            tx,
          );
        });
      } catch (error) {
        throw mapAccountConflict(error);
      }
    }
    return this.get(userId, id);
  }

  /** Ownership is part of the query: another user's id is indistinguishable from a missing one. */
  async findOwned(db: PrismaService | Prisma.TransactionClient, userId: string, id: string) {
    const account = await db.financialAccount.findFirst({
      where: { id, userId },
      include: { ledgerAccount: true },
    });
    if (!account?.ledgerAccount) throw accountNotFound();
    return account;
  }

  private async withBalances(
    accounts: Array<
      FinancialAccount & { ledgerAccount: { id: string; normalBalance: 'DEBIT' | 'CREDIT' } | null }
    >,
  ): Promise<AccountResponse[]> {
    const ledgers = accounts.flatMap((a) => (a.ledgerAccount ? [a.ledgerAccount] : []));
    const balances = await this.ledger.balances(this.prisma, ledgers);
    return accounts.map((a) =>
      toAccountResponse(a, (a.ledgerAccount && balances.get(a.ledgerAccount.id)) ?? ZERO),
    );
  }
}

function mapAccountConflict(error: unknown): unknown {
  const constraint = uniqueViolation(error);
  if (constraint && /financial_accounts_user_active_name|name/.test(constraint)) {
    return new AppException(
      'CONFLICT',
      'You already have an active account with this name.',
      HttpStatus.CONFLICT,
      [{ field: 'name', message: 'Choose a different name' }],
    );
  }
  return error;
}
