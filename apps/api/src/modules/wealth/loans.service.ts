import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateLoanPaymentRequest,
  CreateLoanRequest,
  LoanDetailResponse,
  LoanPaymentResponse,
  LoanResponse,
  UpdateLoanRequest,
} from '@takawise/contracts';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { money, parseMoney, sumMoney, toMoneyString, ZERO } from '../../domain/money/money';
import { dateOnly, instantOnLocalDate, toIsoDate } from '../../domain/time/local-date';
import {
  amortizationSchedule,
  type Instalment,
  monthlyPayment,
  nextDueDate,
  suggestNextPayment,
} from '../../domain/wealth/loan-schedule';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AccountsService, mapAccountConflictError } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentResult } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { conflict, invalid, notFound, userTimeZone } from '../transactions/posting-rules';
import { TransactionsService } from '../transactions/transactions.service';
import { TransfersService } from '../transactions/transfers.service';
import { decimalString } from './wealth-shared';

type Db = PrismaService | Prisma.TransactionClient;

const loanInclude = {
  account: { include: { ledgerAccount: true } },
  payments: {
    orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
    include: {
      transfer: { include: { sourceAccount: true, destinationAccount: true } },
      transaction: { include: { account: true } },
    },
  },
} satisfies Prisma.LoanInclude;

type LoanRow = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

/** System categories used for the interest part of a payment (seeded). */
const INTEREST_CATEGORY = { BORROWED: 'expense.loan_interest', LENT: 'income.profit_interest' };

/**
 * Loans (Phase 8, ADR-022). A borrowed loan is a LOAN (liability) account, a
 * loan given is a LOAN_RECEIVABLE (asset) account; the outstanding amount is
 * always the ledger balance. A payment = a principal TRANSFER (not spending)
 * + an interest EXPENSE (borrowed) or INCOME (lent), committed together.
 * Schedules are estimates from the user's own terms.
 */
@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly transfers: TransfersService,
    private readonly transactions: TransactionsService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateLoanRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<LoanDetailResponse>> {
    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /loans',
        request: input,
        responseStatus: HttpStatus.CREATED,
        run: async (tx) => {
          const currency = input.currency ?? 'BDT';
          const borrowed = input.direction === 'BORROWED';
          const disbursed = Boolean(input.disbursementAccountId);
          const { account } = await this.accounts.createInTx(
            tx,
            userId,
            {
              name: input.name,
              type: borrowed ? 'LOAN' : 'LOAN_RECEIVABLE',
              currency,
              openingDate: input.openingDate,
              // A new loan is created empty and the principal moves through an account;
              // an existing one opens at what is still outstanding.
              openingBalance: disbursed ? '0' : (input.outstandingBalance ?? input.principal),
              institutionName: input.institutionName ?? null,
            },
            client,
          );
          await tx.loan.create({
            data: {
              accountId: account.id,
              userId,
              direction: input.direction,
              counterparty: input.counterparty || null,
              principal: input.principal,
              interestRate: input.interestRate ?? null,
              termMonths: input.termMonths ?? null,
              firstPaymentDate: input.firstPaymentDate ? dateOnly(input.firstPaymentDate) : null,
              notes: input.notes || null,
            },
          });
          if (input.disbursementAccountId) {
            const occurredAt = instantOnLocalDate(
              input.openingDate,
              await userTimeZone(tx, userId),
            );
            await this.transfers.postInTx(
              tx,
              userId,
              {
                // Borrowed: the loan pays into your account. Lent: your account pays the loan.
                sourceAccountId: borrowed ? account.id : input.disbursementAccountId,
                destinationAccountId: borrowed ? input.disbursementAccountId : account.id,
                amount: parseMoney(input.principal),
                currency,
                occurredAt,
                description: borrowed
                  ? `Loan received: ${input.name}`
                  : `Loan given: ${input.name}`,
              },
              client,
              { source: 'disbursementAccountId', destination: 'disbursementAccountId' },
            );
          }
          await this.audit.record(
            {
              action: 'loan.created',
              userId,
              entityType: 'loan',
              entityId: account.id,
              metadata: { direction: input.direction, disbursed },
            },
            client,
            tx,
          );
          return this.detail(tx, userId, account.id);
        },
      });
    } catch (error) {
      throw mapAccountConflictError(error);
    }
  }

  async list(userId: string, status: 'ACTIVE' | 'ARCHIVED' | 'ALL'): Promise<LoanResponse[]> {
    const rows = await this.prisma.loan.findMany({
      where: { userId, ...(status === 'ALL' ? {} : { account: { status } }) },
      include: loanInclude,
      orderBy: [{ account: { status: 'asc' } }, { createdAt: 'asc' }],
    });
    const balances = await this.outstandingFor(this.prisma, rows);
    return rows.map((row) => this.summary(row, balances.get(row.accountId) ?? ZERO).response);
  }

  get(userId: string, id: string): Promise<LoanDetailResponse> {
    return this.detail(this.prisma, userId, id);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateLoanRequest,
    client: ClientContext,
  ): Promise<LoanDetailResponse> {
    const row = await this.findOwned(this.prisma, userId, id);
    const term = input.termMonths === undefined ? row.termMonths : input.termMonths;
    const first =
      input.firstPaymentDate === undefined
        ? row.firstPaymentDate
        : input.firstPaymentDate
          ? dateOnly(input.firstPaymentDate)
          : null;
    if ((term === null) !== (first === null)) {
      throw invalid([
        {
          field: 'firstPaymentDate',
          message: 'Enter both the term and the first payment date, or neither',
        },
      ]);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.name !== undefined || input.institutionName !== undefined) {
          await tx.financialAccount.update({
            where: { id },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.institutionName !== undefined
                ? { institutionName: input.institutionName || null }
                : {}),
            },
          });
        }
        await tx.loan.update({
          where: { accountId: id },
          data: {
            ...(input.counterparty !== undefined
              ? { counterparty: input.counterparty || null }
              : {}),
            ...(input.interestRate !== undefined ? { interestRate: input.interestRate } : {}),
            termMonths: term,
            firstPaymentDate: first,
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'loan.updated',
            userId,
            entityType: 'loan',
            entityId: id,
            metadata: { fields: Object.keys(input) },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      throw mapAccountConflictError(error);
    }
    return this.get(userId, id);
  }

  async setArchived(
    userId: string,
    id: string,
    archived: boolean,
    client: ClientContext,
  ): Promise<LoanDetailResponse> {
    await this.findOwned(this.prisma, userId, id);
    await this.accounts.setArchived(userId, id, archived, client);
    return this.get(userId, id);
  }

  addPayment(
    userId: string,
    id: string,
    input: CreateLoanPaymentRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<LoanDetailResponse>> {
    const principal = parseMoney(input.principal ?? '0');
    const interest = parseMoney(input.interest ?? '0');
    return this.idempotency.execute({
      userId,
      key: idempotencyKey,
      scope: 'POST /loans/:id/payments',
      request: { id, ...input },
      responseStatus: HttpStatus.CREATED,
      run: async (tx) => {
        const loan = await this.findOwned(tx, userId, id);
        if (input.accountId === loan.accountId) {
          throw invalid([{ field: 'accountId', message: 'Choose the account you paid from' }]);
        }
        const outstanding = (await this.outstandingFor(tx, [loan])).get(loan.accountId) ?? ZERO;
        if (principal.greaterThan(outstanding)) {
          throw invalid([
            {
              field: 'principal',
              message: `Principal is more than the ${toMoneyString(outstanding)} still outstanding`,
            },
          ]);
        }
        const borrowed = loan.direction === 'BORROWED';
        const currency = loan.account.currency;
        const occurredAt = new Date(input.occurredAt);
        const description =
          input.description ||
          `${borrowed ? 'Loan payment' : 'Loan repayment received'}: ${loan.account.name}`;

        let paidOn: string | null = null;
        let transferId: string | null = null;
        let transactionId: string | null = null;
        if (principal.greaterThan(0)) {
          const transfer = await this.transfers.postInTx(
            tx,
            userId,
            {
              sourceAccountId: borrowed ? input.accountId : loan.accountId,
              destinationAccountId: borrowed ? loan.accountId : input.accountId,
              amount: principal,
              currency,
              occurredAt,
              description,
            },
            client,
            { source: 'accountId', destination: 'accountId' },
          );
          transferId = transfer.id;
          paidOn = toIsoDate(transfer.effectiveDate);
        }
        if (interest.greaterThan(0)) {
          const categoryId =
            input.interestCategoryId ??
            (
              await tx.category.findUniqueOrThrow({
                where: { systemKey: INTEREST_CATEGORY[loan.direction] },
                select: { id: true },
              })
            ).id;
          const { transaction, effectiveDate } = await this.transactions.postInTx(
            tx,
            userId,
            {
              type: borrowed ? 'EXPENSE' : 'INCOME',
              accountId: input.accountId,
              categoryId,
              amount: interest,
              currency,
              occurredAt,
              description,
            },
            client,
          );
          transactionId = transaction.id;
          paidOn = effectiveDate;
        }

        const payment = await tx.loanPayment.create({
          data: {
            userId,
            loanId: loan.accountId,
            transferId,
            transactionId,
            principal: toMoneyString(principal),
            interest: toMoneyString(interest),
            currency,
            paidOn: dateOnly(paidOn!),
          },
        });
        await this.audit.record(
          {
            action: 'loan.payment.posted',
            userId,
            entityType: 'loan_payment',
            entityId: payment.id,
            metadata: { loanId: loan.accountId },
          },
          client,
          tx,
        );
        return this.detail(tx, userId, loan.accountId);
      },
    });
  }

  async reversePayment(
    userId: string,
    id: string,
    paymentId: string,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<LoanDetailResponse>> {
    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /loans/:id/payments/:paymentId/reverse',
        request: { id, paymentId },
        responseStatus: HttpStatus.OK,
        run: async (tx) => {
          await this.findOwned(tx, userId, id);
          const payment = await tx.loanPayment.findFirst({
            where: { id: paymentId, loanId: id, userId },
          });
          if (!payment) throw notFound('Payment');
          if (payment.status !== 'POSTED')
            throw conflict('This payment has already been reversed.');
          const reason = 'Loan payment reversed';
          if (payment.transferId) {
            await this.transfers.reverseInTx(tx, userId, payment.transferId, reason, client);
          }
          if (payment.transactionId) {
            await this.transactions.reverseInTx(tx, userId, payment.transactionId, reason, client);
          }
          await tx.loanPayment.update({
            where: { id: payment.id },
            data: { status: 'REVERSED', reversedAt: new Date() },
          });
          await this.audit.record(
            {
              action: 'loan.payment.reversed',
              userId,
              entityType: 'loan_payment',
              entityId: payment.id,
              metadata: { loanId: id },
            },
            client,
            tx,
          );
          return this.detail(tx, userId, id);
        },
      });
    } catch (error) {
      if (uniqueViolation(error)?.includes('reverses_id')) {
        throw conflict('This payment has already been reversed.');
      }
      throw error;
    }
  }

  // ── helpers ──

  private async detail(db: Db, userId: string, id: string): Promise<LoanDetailResponse> {
    const row = await this.findOwned(db, userId, id);
    const outstanding = (await this.outstandingFor(db, [row])).get(row.accountId) ?? ZERO;
    const { response, schedule } = this.summary(row, outstanding);
    return {
      ...response,
      schedule: schedule.map((i) => ({
        number: i.number,
        dueDate: i.dueDate,
        payment: toMoneyString(i.payment),
        principal: toMoneyString(i.principal),
        interest: toMoneyString(i.interest),
        balance: toMoneyString(i.balance),
      })),
      payments: row.payments.map((p) => this.toPaymentResponse(row, p)),
    };
  }

  private async findOwned(db: Db, userId: string, id: string): Promise<LoanRow> {
    const row = await db.loan.findFirst({ where: { accountId: id, userId }, include: loanInclude });
    if (!row?.account.ledgerAccount) throw notFound('Loan');
    return row;
  }

  private async outstandingFor(db: Db, rows: readonly LoanRow[]) {
    const ledgers = rows.flatMap((r) => (r.account.ledgerAccount ? [r.account.ledgerAccount] : []));
    const balances = await this.ledger.balances(db, ledgers);
    return new Map(
      rows.map((r) => [r.accountId, balances.get(r.account.ledgerAccount?.id ?? '') ?? ZERO]),
    );
  }

  private summary(
    row: LoanRow,
    outstanding: ReturnType<typeof money>,
  ): { response: LoanResponse; schedule: Instalment[] } {
    const account = row.account;
    const rate = row.interestRate ? money(row.interestRate) : null;
    const hasTerms = row.termMonths !== null && row.firstPaymentDate !== null;
    const schedule = hasTerms
      ? amortizationSchedule({
          principal: money(row.principal),
          annualRatePct: rate ?? ZERO,
          termMonths: row.termMonths!,
          firstPaymentDate: toIsoDate(row.firstPaymentDate!),
        })
      : [];
    const instalment = hasTerms
      ? monthlyPayment(money(row.principal), rate ?? ZERO, row.termMonths!)
      : null;
    const posted = row.payments.filter((p) => p.status === 'POSTED');
    const lastPaidOn = posted.length > 0 ? toIsoDate(posted[0]!.paidOn) : null;
    const suggestion = suggestNextPayment({ outstanding, annualRatePct: rate, instalment });

    return {
      schedule,
      response: {
        id: row.accountId,
        name: account.name,
        direction: row.direction,
        counterparty: row.counterparty,
        institutionName: account.institutionName,
        currency: account.currency,
        openingDate: toIsoDate(account.openingDate),
        status: account.status,
        archivedAt: account.archivedAt?.toISOString() ?? null,
        principal: row.principal.toFixed(4),
        interestRate: decimalString(row.interestRate),
        termMonths: row.termMonths,
        firstPaymentDate: row.firstPaymentDate ? toIsoDate(row.firstPaymentDate) : null,
        notes: row.notes,
        outstanding: toMoneyString(outstanding),
        principalRepaid: toMoneyString(sumMoney(posted.map((p) => p.principal))),
        interestPaid: toMoneyString(sumMoney(posted.map((p) => p.interest))),
        instalment: instalment ? toMoneyString(instalment) : null,
        nextDueDate: outstanding.greaterThan(0)
          ? nextDueDate({ schedule, lastPaidOn, openedOn: toIsoDate(account.openingDate) })
          : null,
        suggestedPayment: suggestion
          ? {
              principal: toMoneyString(suggestion.principal),
              interest: toMoneyString(suggestion.interest),
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  private toPaymentResponse(row: LoanRow, p: LoanRow['payments'][number]): LoanPaymentResponse {
    // The counter-account is the side of the transfer that is not the loan, or the interest account.
    const transferOther = p.transfer
      ? p.transfer.sourceAccountId === row.accountId
        ? p.transfer.destinationAccount
        : p.transfer.sourceAccount
      : null;
    const other = transferOther ?? p.transaction!.account;
    return {
      id: p.id,
      principal: p.principal.toFixed(4),
      interest: p.interest.toFixed(4),
      total: toMoneyString(money(p.principal).plus(money(p.interest))),
      currency: p.currency,
      paidOn: toIsoDate(p.paidOn),
      status: p.status,
      reversedAt: p.reversedAt?.toISOString() ?? null,
      account: { id: other.id, name: other.name, type: other.type },
      transferId: p.transferId,
      transactionId: p.transactionId,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
