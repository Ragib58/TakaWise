import { parseMoney, toMoneyString, ZERO } from '../money/money';
import { monthRange, rollUpSpending, utilization } from './budget-math';
import { goalProgress, savedAmount, unallocated } from './goal-math';

const m = parseMoney;

describe('budget utilization (BUD-02)', () => {
  it.each([
    ['10000', '0', 'ok', '0.00', '10000.0000'],
    ['10000', '7999.99', 'ok', '80.00', '2000.0100'],
    ['10000', '8000', 'warning', '80.00', '2000.0000'],
    ['10000', '10000', 'warning', '100.00', '0.0000'],
    ['10000', '10000.01', 'over', '100.00', '-0.0100'],
    ['3000', '4500', 'over', '150.00', '-1500.0000'],
  ])('limit %s spent %s → %s (%s%%, remaining %s)', (limit, spent, status, pct, remaining) => {
    expect(utilization(m(limit), m(spent))).toEqual({
      limit: toMoneyString(m(limit)),
      spent: toMoneyString(m(spent)),
      remaining,
      percentUsed: pct,
      status,
    });
  });

  it('7999.99 of 10000 rounds to 80.00% but is still "ok" (status uses the exact ratio)', () => {
    expect(utilization(m('10000'), m('7999.99')).status).toBe('ok');
  });
});

describe('monthRange (period boundaries)', () => {
  it.each([
    ['2026-11', '2026-11-01', '2026-11-30'],
    ['2026-12', '2026-12-01', '2026-12-31'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2028-02', '2028-02-01', '2028-02-29'], // leap year
  ])('%s → %s..%s', (month, start, end) => {
    expect(monthRange(month)).toEqual({ start, end });
  });

  it('rejects malformed months', () => {
    expect(() => monthRange('2026-1')).toThrow();
  });
});

describe('rollUpSpending', () => {
  it('adds sub-category spending to a budgeted parent, without double counting', () => {
    const spent = new Map([
      ['utilities', m('100')],
      ['electricity', m('1200')],
      ['gas', m('800')],
      ['food', m('3000')],
      ['unbudgeted', m('999')],
    ]);
    const parents = new Map<string, string | null>([
      ['electricity', 'utilities'],
      ['gas', 'utilities'],
      ['utilities', null],
      ['food', null],
    ]);
    const result = rollUpSpending(['utilities', 'electricity', 'food'], spent, parents);
    expect(toMoneyString(result.get('utilities')!)).toBe('2100.0000');
    expect(toMoneyString(result.get('electricity')!)).toBe('1200.0000');
    expect(toMoneyString(result.get('food')!)).toBe('3000.0000');
    expect(result.has('unbudgeted')).toBe(false);
  });
});

describe('goal progress (GOAL-02, ADR-009)', () => {
  const entries = [
    { kind: 'CONTRIBUTION', status: 'POSTED', amount: '5000' },
    { kind: 'CONTRIBUTION', status: 'REVERSED', amount: '700' }, // corrected...
    { kind: 'REVERSAL', status: 'POSTED', amount: '700' }, // ...by this row
    { kind: 'WITHDRAWAL', status: 'POSTED', amount: '1500' },
  ] as const;

  it('derives saved only from posted contributions minus withdrawals', () => {
    expect(toMoneyString(savedAmount(entries))).toBe('3500.0000');
  });

  it('reports progress and achievement', () => {
    expect(goalProgress(m('10000'), m('3500'))).toEqual({
      saved: '3500.0000',
      remaining: '6500.0000',
      percent: '35.00',
      achieved: false,
    });
    expect(goalProgress(m('3000'), m('3500'))).toMatchObject({
      remaining: '0.0000',
      achieved: true,
    });
  });

  it('never reports negative unallocated money', () => {
    expect(toMoneyString(unallocated(m('1000'), m('400')))).toBe('600.0000');
    expect(unallocated(m('100'), m('400')).equals(ZERO)).toBe(true);
  });
});
