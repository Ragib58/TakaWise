import { Injectable } from '@nestjs/common';
import type { Locale } from '@takawise/contracts';
import { normalBalanceFor, SYSTEM_LEDGER_ACCOUNTS } from '../../domain/ledger/ledger-rules';
import type { Prisma } from '../../generated/prisma/client';
import { toDbLocale } from './user.mapper';

export type NewUser = {
  email: string;
  passwordHash: string;
  fullName: string;
  locale: Locale;
};

/**
 * Creates a user together with everything every user must have: a profile and
 * the per-user system ledger accounts (ADR-007). Runs inside the caller's
 * transaction so a user never exists half-provisioned.
 */
@Injectable()
export class UserProvisioningService {
  createUser(tx: Prisma.TransactionClient, input: NewUser) {
    return tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        status: 'PENDING_VERIFICATION',
        profile: { create: { fullName: input.fullName, locale: toDbLocale(input.locale) } },
        ledgerAccounts: {
          create: SYSTEM_LEDGER_ACCOUNTS.map((account) => ({
            systemCode: account.code,
            class: account.class,
            normalBalance: normalBalanceFor(account.class),
            name: input.locale === 'bn' ? account.nameBn : account.nameEn,
          })),
        },
      },
      include: { profile: true },
    });
  }
}
