import { Injectable } from '@nestjs/common';
import { EXPORT_COLUMNS, type ExportQuery } from '@takawise/contracts';
import type { Writable } from 'node:stream';
import { CSV_BOM, csvRow } from '../../domain/reports/csv';
import { toIsoDate } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

const BATCH = 1000;

/**
 * EXP-01: the user's own transactions and transfers as CSV, streamed in
 * batches so large histories never load into memory at once. Formula-leading
 * cells are neutralised (see domain/reports/csv.ts).
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async writeTransactionsCsv(userId: string, query: ExportQuery, out: Writable): Promise<number> {
    const dateFilter: Prisma.DateTimeFilter | undefined =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
          }
        : undefined;

    out.write(CSV_BOM + csvRow(EXPORT_COLUMNS));
    let rows = 0;

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.transaction.findMany({
        where: { userId, ...(dateFilter ? { effectiveDate: dateFilter } : {}) },
        include: {
          account: { select: { name: true } },
          category: { select: { nameEn: true, nameBn: true } },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      for (const t of batch) {
        out.write(
          csvRow([
            toIsoDate(t.effectiveDate),
            t.type,
            t.status,
            t.account.name,
            '',
            t.category.nameEn,
            t.category.nameBn,
            t.amount.toFixed(4),
            t.currency,
            t.description,
            t.occurredAt.toISOString(),
            t.id,
          ]),
        );
      }
      rows += batch.length;
      if (batch.length < BATCH) break;
      cursor = batch[batch.length - 1]!.id;
    }

    let transferCursor: string | undefined;
    for (;;) {
      const batch: Prisma.TransferGetPayload<{
        include: {
          sourceAccount: { select: { name: true } };
          destinationAccount: { select: { name: true } };
        };
      }>[] = await this.prisma.transfer.findMany({
        where: { userId, ...(dateFilter ? { effectiveDate: dateFilter } : {}) },
        include: {
          sourceAccount: { select: { name: true } },
          destinationAccount: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(transferCursor ? { skip: 1, cursor: { id: transferCursor } } : {}),
      });
      for (const t of batch) {
        out.write(
          csvRow([
            toIsoDate(t.effectiveDate),
            'TRANSFER',
            t.status,
            t.sourceAccount.name,
            t.destinationAccount.name,
            '',
            '',
            t.amount.toFixed(4),
            t.currency,
            t.description,
            t.occurredAt.toISOString(),
            t.id,
          ]),
        );
      }
      rows += batch.length;
      if (batch.length < BATCH) break;
      transferCursor = batch[batch.length - 1]!.id;
    }
    return rows;
  }
}
