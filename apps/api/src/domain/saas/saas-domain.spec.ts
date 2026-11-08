import type { PlanEntitlements } from '@takawise/contracts';
import {
  addMonthsUtc,
  canAddAccount,
  isSubscriptionEffective,
  parseEntitlements,
  withFamilyCover,
} from './entitlements';
import { generateInviteCode, signPayload, verifySignature } from './signatures';

const FREE: PlanEntitlements = {
  maxAccounts: 10,
  aiInsights: true,
  aiDrafts: true,
  receiptOcr: false,
  familyWorkspace: false,
  maxFamilyMembers: 2,
};
const FAMILY: PlanEntitlements = {
  maxAccounts: null,
  aiInsights: true,
  aiDrafts: true,
  receiptOcr: true,
  familyWorkspace: true,
  maxFamilyMembers: 6,
};

describe('entitlements', () => {
  const now = new Date('2026-11-08T10:00:00Z');

  it('grants only live subscriptions inside the paid period', () => {
    const future = new Date('2026-12-08T10:00:00Z');
    const past = new Date('2026-11-01T00:00:00Z');
    expect(isSubscriptionEffective({ status: 'ACTIVE', currentPeriodEnd: future }, now)).toBe(true);
    expect(isSubscriptionEffective({ status: 'PAST_DUE', currentPeriodEnd: future }, now)).toBe(
      true,
    );
    expect(isSubscriptionEffective({ status: 'ACTIVE', currentPeriodEnd: past }, now)).toBe(false);
    expect(isSubscriptionEffective({ status: 'CANCELED', currentPeriodEnd: future }, now)).toBe(
      false,
    );
    expect(isSubscriptionEffective({ status: 'EXPIRED', currentPeriodEnd: future }, now)).toBe(
      false,
    );
  });

  it('fails closed on corrupt plan JSON', () => {
    expect(parseEntitlements(FAMILY)).toEqual(FAMILY);
    const broken = parseEntitlements({ maxAccounts: 'lots' });
    expect(broken.receiptOcr).toBe(false);
    expect(broken.maxAccounts).toBe(1);
  });

  it('adds family cover but never the right to own a workspace', () => {
    const covered = withFamilyCover(FREE, FAMILY);
    expect(covered).toMatchObject({ maxAccounts: null, receiptOcr: true, familyWorkspace: false });
    expect(withFamilyCover(FREE, null)).toBe(FREE);
  });

  it('enforces the account limit', () => {
    expect(canAddAccount(FREE, 9)).toBe(true);
    expect(canAddAccount(FREE, 10)).toBe(false);
    expect(canAddAccount(FAMILY, 10_000)).toBe(true);
  });

  it('adds calendar months, clamping to month end', () => {
    expect(addMonthsUtc(new Date('2026-01-31T05:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T05:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2026-11-08T10:00:00Z'), 12).toISOString()).toBe(
      '2027-11-08T10:00:00.000Z',
    );
  });
});

describe('webhook signatures', () => {
  const secret = 's'.repeat(40);
  const body = Buffer.from('{"id":"evt_1"}');
  const t = 1_800_000_000;

  it('accepts a fresh, matching signature', () => {
    const header = signPayload(secret, body, t);
    expect(verifySignature({ secret, rawBody: body, header, nowSeconds: t + 10 })).toBe('ok');
  });

  it('rejects tampering, wrong secret, staleness and garbage', () => {
    const header = signPayload(secret, body, t);
    expect(
      verifySignature({ secret, rawBody: Buffer.from('{"id":"evt_2"}'), header, nowSeconds: t }),
    ).toBe('mismatch');
    expect(verifySignature({ secret: 'x'.repeat(40), rawBody: body, header, nowSeconds: t })).toBe(
      'mismatch',
    );
    expect(verifySignature({ secret, rawBody: body, header, nowSeconds: t + 301 })).toBe('stale');
    expect(verifySignature({ secret, rawBody: body, header, nowSeconds: t - 301 })).toBe('stale');
    expect(verifySignature({ secret, rawBody: body, header: undefined, nowSeconds: t })).toBe(
      'missing',
    );
    expect(verifySignature({ secret, rawBody: body, header: 't=abc,v1=zz', nowSeconds: t })).toBe(
      'malformed',
    );
  });

  it('generates unambiguous invite codes', () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });
});
