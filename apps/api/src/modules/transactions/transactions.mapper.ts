import type { TransactionResponse, TransferResponse } from '@takawise/contracts';
import { toIsoDate } from '../../domain/time/local-date';
import type { Prisma } from '../../generated/prisma/client';

export const transactionInclude = {
  account: { select: { id: true, name: true, type: true } },
  category: { select: { id: true, nameEn: true, nameBn: true } },
} satisfies Prisma.TransactionInclude;

export type TransactionWithRefs = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

export function toTransactionResponse(trx: TransactionWithRefs): TransactionResponse {
  return {
    id: trx.id,
    type: trx.type,
    status: trx.status,
    amount: trx.amount.toFixed(4),
    currency: trx.currency,
    occurredAt: trx.occurredAt.toISOString(),
    effectiveDate: toIsoDate(trx.effectiveDate),
    description: trx.description,
    account: trx.account,
    category: trx.category,
    reversedAt: trx.reversedAt?.toISOString() ?? null,
    createdAt: trx.createdAt.toISOString(),
  };
}

export const transferInclude = {
  sourceAccount: { select: { id: true, name: true, type: true } },
  destinationAccount: { select: { id: true, name: true, type: true } },
} satisfies Prisma.TransferInclude;

export type TransferWithRefs = Prisma.TransferGetPayload<{ include: typeof transferInclude }>;

export function toTransferResponse(t: TransferWithRefs): TransferResponse {
  return {
    id: t.id,
    status: t.status,
    amount: t.amount.toFixed(4),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    effectiveDate: toIsoDate(t.effectiveDate),
    description: t.description,
    sourceAccount: t.sourceAccount,
    destinationAccount: t.destinationAccount,
    reversedAt: t.reversedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}
