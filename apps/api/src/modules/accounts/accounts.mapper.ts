import type { AccountResponse } from '@takawise/contracts';
import { type Money, toMoneyString } from '../../domain/money/money';
import { toIsoDate } from '../../domain/time/local-date';
import type { FinancialAccount } from '../../generated/prisma/client';

export function toAccountResponse(account: FinancialAccount, balance: Money): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingDate: toIsoDate(account.openingDate),
    openingBalance: account.openingBalance.toFixed(4),
    institutionName: account.institutionName,
    creditLimit: account.creditLimit ? account.creditLimit.toFixed(4) : null,
    status: account.status,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    balance: toMoneyString(balance),
    balanceType: account.type === 'CREDIT_CARD_TRACKING' ? 'LIABILITY' : 'ASSET',
    createdAt: account.createdAt.toISOString(),
  };
}
