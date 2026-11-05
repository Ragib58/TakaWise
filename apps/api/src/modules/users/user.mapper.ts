import type { Locale as ApiLocale, MeResponse } from '@takawise/contracts';
import type { Locale as DbLocale } from '../../generated/prisma/enums';
import type { User, UserProfile } from '../../generated/prisma/client';

export const toDbLocale = (locale: ApiLocale): DbLocale => (locale === 'bn' ? 'BN' : 'EN');
export const toApiLocale = (locale: DbLocale): ApiLocale => (locale === 'BN' ? 'bn' : 'en');

/** Explicit mapping: Prisma entities never leave the API (blueprint Phase 2). */
export function toMeResponse(user: User & { profile: UserProfile | null }): MeResponse {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    status: user.status,
    profile: {
      fullName: user.profile?.fullName ?? '',
      locale: toApiLocale(user.profile?.locale ?? 'EN'),
      timezone: user.profile?.timezone ?? 'Asia/Dhaka',
      defaultCurrency: user.profile?.defaultCurrency ?? 'BDT',
    },
    createdAt: user.createdAt.toISOString(),
  };
}
