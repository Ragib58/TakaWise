import { Injectable } from '@nestjs/common';
import {
  type CreateNetWorthItemRequest,
  type CreateValuationRequest,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  type NetWorthHistoryResponse,
  type NetWorthItemResponse,
  type NetWorthResponse,
  sideForItemKind,
  type UpdateNetWorthItemRequest,
} from '@takawise/contracts';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { ledgerClassForAccountType } from '../../domain/ledger/ledger-rules';
import { toMoneyString, ZERO } from '../../domain/money/money';
import { dateOnly, localDateOf, toIsoDate } from '../../domain/time/local-date';
import {
  type AccountInput,
  computeNetWorth,
  historyDates,
  type ItemInput,
  latestValuation,
} from '../../domain/wealth/net-worth';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { conflict, invalid, notFound } from '../transactions/posting-rules';
import {
  assertValuationDate,
  mapValuationConflict,
  toDatedValues,
  toValuationResponse,
} from './wealth-shared';

const itemInclude = {
  valuations: { orderBy: { valuedOn: 'desc' } },
} satisfies Prisma.NetWorthItemInclude;
type ItemRow = Prisma.NetWorthItemGetPayload<{ include: typeof itemInclude }>;

/**
 * Net worth (Phase 8, ADR-023): computed on read from the ledger, valuations
 * and net-worth items — no stored snapshots to drift. History is the same
 * calculation at past month-ends.
 */
@Injectable()
export class NetWorthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string, asOf?: string): Promise<NetWorthResponse> {
    const { today, defaultCurrency } = await this.profile(userId);
    const date = asOf ?? today;
    if (date > today) throw invalid([{ field: 'asOf', message: 'Choose today or a past date' }]);
    const inputs = await this.inputs(userId);
    return {
      asOf: date,
      currencies: orderCurrencies(computeNetWorth({ asOf: date, ...inputs }), defaultCurrency).map(
        (c) => ({
          currency: c.currency,
          assets: toMoneyString(c.assets),
          liabilities: toMoneyString(c.liabilities),
          netWorth: toMoneyString(c.netWorth),
          groups: c.groups.map((g) => ({ ...g, total: toMoneyString(g.total) })),
          lines: c.lines.map((l) => ({
            source: l.source,
            id: l.id,
            name: l.name,
            type: l.type,
            group: l.group,
            side: l.side,
            value: toMoneyString(l.value),
            recorded: l.recorded ? toMoneyString(l.recorded) : null,
            basis: l.basis,
            valuedOn: l.valuedOn,
          })),
        }),
      ),
    };
  }

  async history(userId: string, months: number): Promise<NetWorthHistoryResponse> {
    const { today, defaultCurrency } = await this.profile(userId);
    const dates = historyDates(today, months);
    const inputs = await this.inputs(userId);
    const snapshots = dates.map((date) => ({
      date,
      values: computeNetWorth({ asOf: date, ...inputs }),
    }));
    const currencies = orderCurrencies(
      [...new Set(snapshots.flatMap((s) => s.values.map((v) => v.currency)))].map((currency) => ({
        currency,
      })),
      defaultCurrency,
    ).map((c) => c.currency);
    return {
      dates,
      series: currencies.map((currency) => ({
        currency,
        points: snapshots.map(({ date, values }) => {
          const v = values.find((x) => x.currency === currency);
          return {
            date,
            assets: toMoneyString(v?.assets ?? ZERO),
            liabilities: toMoneyString(v?.liabilities ?? ZERO),
            netWorth: toMoneyString(v?.netWorth ?? ZERO),
          };
        }),
      })),
    };
  }

  // ───────────────────────── Net-worth items ─────────────────────────

  async listItems(
    userId: string,
    status: 'ACTIVE' | 'ARCHIVED' | 'ALL',
  ): Promise<NetWorthItemResponse[]> {
    const rows = await this.prisma.netWorthItem.findMany({
      where: { userId, ...(status === 'ALL' ? {} : { status }) },
      include: itemInclude,
      orderBy: [{ status: 'asc' }, { side: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toItemResponse);
  }

  async createItem(
    userId: string,
    input: CreateNetWorthItemRequest,
    client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    const { today } = await this.profile(userId);
    assertValuationDate(input.valuedOn, today);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const item = await tx.netWorthItem.create({
          data: {
            userId,
            side: sideForItemKind(input.kind),
            kind: input.kind,
            name: input.name,
            currency: input.currency ?? DEFAULT_CURRENCY,
            notes: input.notes || null,
          },
        });
        await tx.valuation.create({
          data: {
            userId,
            itemId: item.id,
            value: input.value,
            currency: item.currency,
            valuedOn: dateOnly(input.valuedOn),
            source: input.source ?? 'USER_ENTERED',
          },
        });
        await this.audit.record(
          {
            action: 'net_worth_item.created',
            userId,
            entityType: 'net_worth_item',
            entityId: item.id,
            metadata: { kind: input.kind },
          },
          client,
          tx,
        );
        return item.id;
      });
      return this.getItem(userId, id);
    } catch (error) {
      throw mapItemConflict(error);
    }
  }

  async getItem(userId: string, id: string): Promise<NetWorthItemResponse> {
    return toItemResponse(await this.findItem(userId, id));
  }

  async updateItem(
    userId: string,
    id: string,
    input: UpdateNetWorthItemRequest,
    client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    await this.findItem(userId, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.netWorthItem.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'net_worth_item.updated',
            userId,
            entityType: 'net_worth_item',
            entityId: id,
            metadata: { fields: Object.keys(input) },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      throw mapItemConflict(error);
    }
    return this.getItem(userId, id);
  }

  /** Archive = sold or settled: no longer counted from today on (history keeps it). */
  async setItemArchived(
    userId: string,
    id: string,
    archived: boolean,
    client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    const item = await this.findItem(userId, id);
    if ((item.status === 'ARCHIVED') !== archived) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.netWorthItem.update({
            where: { id },
            data: archived
              ? { status: 'ARCHIVED', archivedAt: new Date() }
              : { status: 'ACTIVE', archivedAt: null },
          });
          await this.audit.record(
            {
              action: archived ? 'net_worth_item.archived' : 'net_worth_item.restored',
              userId,
              entityType: 'net_worth_item',
              entityId: id,
            },
            client,
            tx,
          );
        });
      } catch (error) {
        throw mapItemConflict(error);
      }
    }
    return this.getItem(userId, id);
  }

  async addItemValuation(
    userId: string,
    id: string,
    input: CreateValuationRequest,
    client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    const item = await this.findItem(userId, id);
    const { today } = await this.profile(userId);
    assertValuationDate(input.valuedOn, today);
    try {
      await this.prisma.$transaction(async (tx) => {
        const valuation = await tx.valuation.create({
          data: {
            userId,
            itemId: id,
            value: input.value,
            currency: item.currency,
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
            metadata: { itemId: id, source: valuation.source },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      throw mapValuationConflict(error);
    }
    return this.getItem(userId, id);
  }

  async deleteItemValuation(
    userId: string,
    id: string,
    valuationId: string,
    client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    const item = await this.findItem(userId, id);
    const valuation = item.valuations.find((v) => v.id === valuationId);
    if (!valuation) throw notFound('Valuation');
    if (item.valuations.length === 1) {
      throw conflict('An item needs at least one value. Archive the item instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.valuation.delete({ where: { id: valuation.id } });
      await this.audit.record(
        {
          action: 'valuation.deleted',
          userId,
          entityType: 'valuation',
          entityId: valuation.id,
          metadata: { itemId: id },
        },
        client,
        tx,
      );
    });
    return this.getItem(userId, id);
  }

  // ── helpers ──

  private async findItem(userId: string, id: string): Promise<ItemRow> {
    const item = await this.prisma.netWorthItem.findFirst({
      where: { id, userId },
      include: itemInclude,
    });
    if (!item) throw notFound('Item');
    return item;
  }

  private async profile(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timeZone = profile?.timezone ?? DEFAULT_TIMEZONE;
    return {
      timeZone,
      today: localDateOf(new Date(), timeZone),
      defaultCurrency: profile?.defaultCurrency ?? DEFAULT_CURRENCY,
    };
  }

  /** Everything the calculation needs, in three queries (accounts, movements, items). */
  private async inputs(userId: string): Promise<{ accounts: AccountInput[]; items: ItemInput[] }> {
    const { timeZone } = await this.profile(userId);
    const [accounts, items] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where: { userId },
        include: {
          ledgerAccount: { select: { id: true, normalBalance: true } },
          investment: { include: { valuations: true } },
        },
      }),
      this.prisma.netWorthItem.findMany({ where: { userId }, include: { valuations: true } }),
    ]);
    const ledgers = accounts.flatMap((a) => (a.ledgerAccount ? [a.ledgerAccount] : []));
    const movements = await this.ledger.dailyMovements(this.prisma, ledgers);
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        side: ledgerClassForAccountType(a.type),
        currency: a.currency,
        openedOn: toIsoDate(a.openingDate),
        archived: a.status === 'ARCHIVED',
        movements: movements.get(a.ledgerAccount?.id ?? '') ?? [],
        ...(a.investment ? { valuations: toDatedValues(a.investment.valuations) } : {}),
      })),
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        side: i.side,
        currency: i.currency,
        archivedOn: i.archivedAt ? localDateOf(i.archivedAt, timeZone) : null,
        valuations: toDatedValues(i.valuations),
      })),
    };
  }
}

function orderCurrencies<T extends { currency: string }>(rows: T[], first: string): T[] {
  return [...rows].sort((a, b) =>
    a.currency === first ? -1 : b.currency === first ? 1 : a.currency.localeCompare(b.currency),
  );
}

function toItemResponse(item: ItemRow): NetWorthItemResponse {
  const latest = latestValuation(toDatedValues(item.valuations), '9999-12-31');
  return {
    id: item.id,
    name: item.name,
    side: item.side,
    kind: item.kind,
    currency: item.currency,
    notes: item.notes,
    status: item.status,
    archivedAt: item.archivedAt?.toISOString() ?? null,
    value: latest ? toMoneyString(latest.value) : null,
    valuedOn: latest?.date ?? null,
    valueBasis: latest?.source ?? null,
    valuations: item.valuations.map(toValuationResponse),
    createdAt: item.createdAt.toISOString(),
  };
}

function mapItemConflict(error: unknown): unknown {
  const constraint = uniqueViolation(error);
  if (constraint && /net_worth_items_user_active_name|name/.test(constraint)) {
    return conflict('You already have an item with this name.');
  }
  return error;
}
