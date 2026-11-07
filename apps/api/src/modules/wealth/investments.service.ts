import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreateInvestmentRequest,
  CreateValuationRequest,
  InvestmentDetailResponse,
  InvestmentResponse,
  UpdateInvestmentRequest,
} from '@takawise/contracts';
import type { ClientContext } from '../../common/http/client-context';
import { parseMoney, toMoneyString } from '../../domain/money/money';
import { dateOnly, instantOnLocalDate, localDateOf, toIsoDate } from '../../domain/time/local-date';
import { accountValueAsOf } from '../../domain/wealth/net-worth';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AccountsService, mapAccountConflictError } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService, type IdempotentResult } from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { invalid, notFound, userTimeZone } from '../transactions/posting-rules';
import { TransfersService } from '../transactions/transfers.service';
import {
  assertValuationDate,
  decimalString,
  mapValuationConflict,
  toDatedValues,
  toValuationResponse,
} from './wealth-shared';

type Db = PrismaService | Prisma.TransactionClient;

const investmentInclude = {
  account: { include: { ledgerAccount: true } },
  valuations: { orderBy: { valuedOn: 'desc' } },
} satisfies Prisma.InvestmentInclude;

type InvestmentRow = Prisma.InvestmentGetPayload<{ include: typeof investmentInclude }>;

/**
 * Investments (Phase 8, ADR-022): an INVESTMENT account plus details. Money
 * moved in or out is a transfer, returns are income on the account, so cash
 * balances and the investment are never double counted.
 */
@Injectable()
export class InvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly transfers: TransfersService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateInvestmentRequest,
    idempotencyKey: string,
    client: ClientContext,
  ): Promise<IdempotentResult<InvestmentDetailResponse>> {
    const initialAmount = input.initialAmount ?? '0';
    try {
      return await this.idempotency.execute({
        userId,
        key: idempotencyKey,
        scope: 'POST /investments',
        request: input,
        responseStatus: HttpStatus.CREATED,
        run: async (tx) => {
          const currency = input.currency ?? 'BDT';
          const funded = Boolean(input.fundingAccountId);
          const { account } = await this.accounts.createInTx(
            tx,
            userId,
            {
              name: input.name,
              type: 'INVESTMENT',
              currency,
              openingDate: input.openingDate,
              // Funded from an account → a transfer moves the money (no new money appears).
              openingBalance: funded ? '0' : initialAmount,
              institutionName: input.institutionName ?? null,
            },
            client,
          );
          await tx.investment.create({
            data: {
              accountId: account.id,
              userId,
              kind: input.kind,
              maturityDate: input.maturityDate ? dateOnly(input.maturityDate) : null,
              interestRate: input.interestRate ?? null,
              expectedMaturityValue: input.expectedMaturityValue ?? null,
              quantity: input.quantity ?? null,
              quantityUnit: input.quantityUnit || null,
              notes: input.notes || null,
            },
          });
          if (input.fundingAccountId) {
            await this.transfers.postInTx(
              tx,
              userId,
              {
                sourceAccountId: input.fundingAccountId,
                destinationAccountId: account.id,
                amount: parseMoney(initialAmount),
                currency,
                occurredAt: instantOnLocalDate(input.openingDate, await userTimeZone(tx, userId)),
                description: `Invested in ${input.name}`,
              },
              client,
              { source: 'fundingAccountId', destination: 'fundingAccountId' },
            );
          }
          await this.audit.record(
            {
              action: 'investment.created',
              userId,
              entityType: 'investment',
              entityId: account.id,
              metadata: { kind: input.kind, funded },
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

  async list(userId: string, status: 'ACTIVE' | 'ARCHIVED' | 'ALL'): Promise<InvestmentResponse[]> {
    const rows = await this.prisma.investment.findMany({
      where: { userId, ...(status === 'ALL' ? {} : { account: { status } }) },
      include: investmentInclude,
      orderBy: [{ account: { status: 'asc' } }, { createdAt: 'asc' }],
    });
    const today = await this.today(this.prisma, userId);
    const movements = await this.movementsFor(this.prisma, rows);
    return rows.map((row) => this.toResponse(row, movements.get(row.accountId) ?? [], today));
  }

  get(userId: string, id: string): Promise<InvestmentDetailResponse> {
    return this.detail(this.prisma, userId, id);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateInvestmentRequest,
    client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    const row = await this.findOwned(this.prisma, userId, id);
    if (input.maturityDate && input.maturityDate < toIsoDate(row.account.openingDate)) {
      throw invalidField('maturityDate', 'Maturity cannot be before the opening date');
    }
    const quantity = input.quantity === undefined ? row.quantity : input.quantity;
    const unit = input.quantityUnit === undefined ? row.quantityUnit : input.quantityUnit;
    if (unit && quantity === null) {
      throw invalidField('quantity', 'Enter the quantity for this unit');
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
        await tx.investment.update({
          where: { accountId: id },
          data: {
            ...(input.maturityDate !== undefined
              ? { maturityDate: input.maturityDate ? dateOnly(input.maturityDate) : null }
              : {}),
            ...(input.interestRate !== undefined ? { interestRate: input.interestRate } : {}),
            ...(input.expectedMaturityValue !== undefined
              ? { expectedMaturityValue: input.expectedMaturityValue }
              : {}),
            ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
            ...(input.quantityUnit !== undefined
              ? { quantityUnit: input.quantityUnit || null }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'investment.updated',
            userId,
            entityType: 'investment',
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
  ): Promise<InvestmentDetailResponse> {
    await this.findOwned(this.prisma, userId, id);
    await this.accounts.setArchived(userId, id, archived, client);
    return this.get(userId, id);
  }

  async addValuation(
    userId: string,
    id: string,
    input: CreateValuationRequest,
    client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    const row = await this.findOwned(this.prisma, userId, id);
    assertValuationDate(
      input.valuedOn,
      await this.today(this.prisma, userId),
      toIsoDate(row.account.openingDate),
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        const valuation = await tx.valuation.create({
          data: {
            userId,
            investmentId: id,
            value: input.value,
            currency: row.account.currency,
            valuedOn: dateOnly(input.valuedOn),
            source: input.source ?? 'USER_ENTERED',
            note: input.note || null,
          },
        });
        await this.audit.record(
          {
            action: 'valuation.created',
            userId,
            entityType: 'valuation',
            entityId: valuation.id,
            metadata: { investmentId: id, source: valuation.source },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      throw mapValuationConflict(error);
    }
    return this.get(userId, id);
  }

  async deleteValuation(
    userId: string,
    id: string,
    valuationId: string,
    client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    await this.findOwned(this.prisma, userId, id);
    const valuation = await this.prisma.valuation.findFirst({
      where: { id: valuationId, investmentId: id, userId },
    });
    if (!valuation) throw notFound('Valuation');
    await this.prisma.$transaction(async (tx) => {
      await tx.valuation.delete({ where: { id: valuation.id } });
      await this.audit.record(
        {
          action: 'valuation.deleted',
          userId,
          entityType: 'valuation',
          entityId: valuation.id,
          metadata: { investmentId: id },
        },
        client,
        tx,
      );
    });
    return this.get(userId, id);
  }

  // ── helpers ──

  private async detail(db: Db, userId: string, id: string): Promise<InvestmentDetailResponse> {
    const row = await this.findOwned(db, userId, id);
    const movements = await this.movementsFor(db, [row]);
    return {
      ...this.toResponse(row, movements.get(row.accountId) ?? [], await this.today(db, userId)),
      valuations: row.valuations.map(toValuationResponse),
    };
  }

  private async findOwned(db: Db, userId: string, id: string): Promise<InvestmentRow> {
    const row = await db.investment.findFirst({
      where: { accountId: id, userId },
      include: investmentInclude,
    });
    if (!row?.account.ledgerAccount) throw notFound('Investment');
    return row;
  }

  private async movementsFor(db: Db, rows: readonly InvestmentRow[]) {
    const ledgers = rows.flatMap((r) => (r.account.ledgerAccount ? [r.account.ledgerAccount] : []));
    const byLedger = await this.ledger.dailyMovements(db, ledgers);
    return new Map(
      rows.map((r) => [r.accountId, byLedger.get(r.account.ledgerAccount?.id ?? '') ?? []]),
    );
  }

  private async today(db: Db, userId: string): Promise<string> {
    const profile = await db.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return localDateOf(new Date(), profile?.timezone ?? 'Asia/Dhaka');
  }

  private toResponse(
    row: InvestmentRow,
    movements: Parameters<typeof accountValueAsOf>[0],
    today: string,
  ): InvestmentResponse {
    const { value, recorded, valuation } = accountValueAsOf(
      movements,
      toDatedValues(row.valuations),
      today,
    );
    const account = row.account;
    return {
      id: row.accountId,
      name: account.name,
      kind: row.kind,
      currency: account.currency,
      institutionName: account.institutionName,
      openingDate: toIsoDate(account.openingDate),
      status: account.status,
      archivedAt: account.archivedAt?.toISOString() ?? null,
      maturityDate: row.maturityDate ? toIsoDate(row.maturityDate) : null,
      interestRate: decimalString(row.interestRate),
      expectedMaturityValue: decimalString(row.expectedMaturityValue),
      quantity: row.quantity ? row.quantity.toFixed(8) : null,
      quantityUnit: row.quantityUnit,
      notes: row.notes,
      recordedValue: toMoneyString(recorded),
      currentValue: toMoneyString(value),
      valueBasis: valuation ? valuation.source : 'RECORDED',
      valuedOn: valuation?.date ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const invalidField = (field: string, message: string) => invalid([{ field, message }]);
