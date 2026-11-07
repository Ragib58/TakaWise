import type { ValuationResponse } from '@takawise/contracts';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import { money } from '../../domain/money/money';
import { toIsoDate } from '../../domain/time/local-date';
import type { DatedValue } from '../../domain/wealth/net-worth';
import type { Prisma, Valuation } from '../../generated/prisma/client';
import { conflict, invalid } from '../transactions/posting-rules';

/** Shared helpers for the Phase 8 wealth modules (investments, loans, net worth). */

export const decimalString = (value: Prisma.Decimal | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toFixed(4);

export function toValuationResponse(v: Valuation): ValuationResponse {
  return {
    id: v.id,
    value: v.value.toFixed(4),
    currency: v.currency,
    valuedOn: toIsoDate(v.valuedOn),
    source: v.source,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
  };
}

export function toDatedValues(valuations: readonly Valuation[]): DatedValue[] {
  return valuations.map((v) => ({
    date: toIsoDate(v.valuedOn),
    value: money(v.value),
    source: v.source,
  }));
}

/** A valuation is a fact about the past: not in the future, not before the thing existed. */
export function assertValuationDate(valuedOn: string, today: string, openedOn?: string): void {
  if (valuedOn > today) {
    throw invalid([{ field: 'valuedOn', message: 'A value cannot be dated in the future' }]);
  }
  if (openedOn && valuedOn < openedOn) {
    throw invalid([
      { field: 'valuedOn', message: `This was opened on ${openedOn}; choose a later date` },
    ]);
  }
}

export function mapValuationConflict(error: unknown): unknown {
  const constraint = uniqueViolation(error);
  if (constraint && /valuations_.*date|valued_on/.test(constraint)) {
    return conflict('There is already a value for this date. Delete it first to replace it.');
  }
  return error;
}
