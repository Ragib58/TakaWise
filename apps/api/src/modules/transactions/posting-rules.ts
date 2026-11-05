import { HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { DEFAULT_TIMEZONE } from '@takawise/contracts';
import { localDateOf, toIsoDate } from '../../domain/time/local-date';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Service-level posting rules shared by transactions and transfers. The
 * database enforces ownership/currency/balance too; these produce friendly
 * errors and cover rules SQL cannot (archived state, dates relative to "today").
 */

export function invalid(details: ApiErrorDetail[]): AppException {
  return new AppException(
    'VALIDATION_ERROR',
    'Please check the submitted fields.',
    HttpStatus.BAD_REQUEST,
    details,
  );
}

export function conflict(message: string): AppException {
  return new AppException('CONFLICT', message, HttpStatus.CONFLICT);
}

export function notFound(what: string): AppException {
  return new AppException('NOT_FOUND', `${what} not found.`, HttpStatus.NOT_FOUND);
}

export async function userTimeZone(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const profile = await tx.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return profile?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * Effective date in the user's time zone (ADR-012). Postings may not be dated
 * in the future, nor before the account was opened.
 */
export function effectiveDateFor(args: {
  occurredAt: Date;
  timeZone: string;
  openingDates: Array<{ field: string; openingDate: Date }>;
  now?: Date;
}): string {
  const effectiveDate = localDateOf(args.occurredAt, args.timeZone);
  const today = localDateOf(args.now ?? new Date(), args.timeZone);
  if (effectiveDate > today) {
    throw invalid([{ field: 'occurredAt', message: 'Cannot record a transaction in the future' }]);
  }
  for (const { field, openingDate } of args.openingDates) {
    if (effectiveDate < toIsoDate(openingDate)) {
      throw invalid([
        {
          field,
          message: `The account was opened on ${toIsoDate(openingDate)}; choose a later date`,
        },
      ]);
    }
  }
  return effectiveDate;
}

export type PostableAccount = {
  id: string;
  currency: string;
  status: 'ACTIVE' | 'ARCHIVED';
  openingDate: Date;
  ledgerAccount: { id: string } | null;
};

/** The account must exist for this user (else 404), be active and match the currency. */
export function assertPostable(
  account: PostableAccount | null,
  field: string,
  currency: string,
): asserts account is PostableAccount & { ledgerAccount: { id: string } } {
  if (!account?.ledgerAccount) throw notFound('Account');
  if (account.status !== 'ACTIVE')
    throw conflict('This account is archived. Restore it to record new entries.');
  if (account.currency !== currency) {
    throw invalid([{ field, message: `This account uses ${account.currency}, not ${currency}` }]);
  }
}
