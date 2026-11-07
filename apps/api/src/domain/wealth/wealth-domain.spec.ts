import { money, parseMoney, sumMoney, toMoneyString } from '../money/money';
import {
  addMonths,
  amortizationSchedule,
  monthlyPayment,
  nextDueDate,
  suggestNextPayment,
} from './loan-schedule';
import {
  type AccountInput,
  bookValueAsOf,
  computeNetWorth,
  historyDates,
  type ItemInput,
} from './net-worth';

const m = parseMoney;
const s = (v: { toFixed(dp: number): string }) => v.toFixed(2);

describe('loan schedule', () => {
  it('computes the standard EMI (1 lakh, 12% for 12 months = 8,884.88)', () => {
    expect(s(monthlyPayment(m('100000'), m('12'), 12))).toBe('8884.88');
  });

  it('splits an interest-free loan evenly', () => {
    expect(s(monthlyPayment(m('120000'), m('0'), 12))).toBe('10000.00');
  });

  it('builds a schedule that ends at exactly zero and repays the principal', () => {
    const rows = amortizationSchedule({
      principal: m('100000'),
      annualRatePct: m('12'),
      termMonths: 12,
      firstPaymentDate: '2026-01-31',
    });
    expect(rows).toHaveLength(12);
    expect(s(rows[0]!.interest)).toBe('1000.00');
    expect(s(rows[0]!.principal)).toBe('7884.88');
    expect(rows[1]!.dueDate).toBe('2026-02-28');
    expect(rows.at(-1)!.balance.isZero()).toBe(true);
    expect(toMoneyString(sumMoney(rows.map((r) => r.principal)))).toBe('100000.0000');
    for (const row of rows) {
      expect(row.payment.equals(row.principal.plus(row.interest))).toBe(true);
      expect(row.principal.isNegative()).toBe(false);
    }
  });

  it('adds months and clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-03-31', 0)).toBe('2026-03-31');
  });

  it('suggests one month of interest on what is actually outstanding', () => {
    const split = suggestNextPayment({
      outstanding: m('50000'),
      annualRatePct: m('12'),
      instalment: m('8884.88'),
    });
    expect(s(split!.interest)).toBe('500.00');
    expect(s(split!.principal)).toBe('8384.88');

    const last = suggestNextPayment({
      outstanding: m('1000'),
      annualRatePct: m('12'),
      instalment: m('8884.88'),
    });
    expect(s(last!.principal)).toBe('1000.00');

    const informal = suggestNextPayment({
      outstanding: m('5000'),
      annualRatePct: null,
      instalment: null,
    });
    expect(s(informal!.interest)).toBe('0.00');
    expect(suggestNextPayment({ outstanding: m('0'), annualRatePct: null, instalment: null })).toBe(
      null,
    );
  });

  it('finds the next due date after the latest payment', () => {
    const schedule = amortizationSchedule({
      principal: m('30000'),
      annualRatePct: m('0'),
      termMonths: 3,
      firstPaymentDate: '2026-09-10',
    });
    expect(nextDueDate({ schedule, lastPaidOn: null, openedOn: '2026-08-01' })).toBe('2026-09-10');
    expect(nextDueDate({ schedule, lastPaidOn: '2026-09-09', openedOn: '2026-08-01' })).toBe(
      '2026-09-10',
    );
    expect(nextDueDate({ schedule, lastPaidOn: '2026-09-12', openedOn: '2026-08-01' })).toBe(
      '2026-10-10',
    );
    expect(nextDueDate({ schedule, lastPaidOn: '2026-11-10', openedOn: '2026-08-01' })).toBe(null);
    // Imported old loan: skip instalments before it was recorded.
    expect(nextDueDate({ schedule, lastPaidOn: null, openedOn: '2026-10-01' })).toBe('2026-10-10');
  });
});

const account = (over: Partial<AccountInput> & Pick<AccountInput, 'id'>): AccountInput => ({
  name: over.id,
  type: 'CASH',
  side: 'ASSET',
  currency: 'BDT',
  openedOn: '2026-01-01',
  archived: false,
  movements: [],
  ...over,
});

describe('net worth', () => {
  it('is assets minus liabilities, each account counted once at its ledger balance', () => {
    const [bdt] = computeNetWorth({
      asOf: '2026-11-07',
      accounts: [
        account({ id: 'cash', movements: [{ date: '2026-01-01', amount: m('1000') }] }),
        account({
          id: 'card',
          type: 'CREDIT_CARD_TRACKING',
          side: 'LIABILITY',
          movements: [{ date: '2026-02-01', amount: m('300') }],
        }),
        account({
          id: 'home loan',
          type: 'LOAN',
          side: 'LIABILITY',
          movements: [{ date: '2026-03-01', amount: m('200') }],
        }),
      ],
      items: [],
    });
    expect(s(bdt!.assets)).toBe('1000.00');
    expect(s(bdt!.liabilities)).toBe('500.00');
    expect(s(bdt!.netWorth)).toBe('500.00');
    expect(bdt!.groups.map((g) => g.group)).toEqual(['CASH_AND_ACCOUNTS', 'CREDIT_CARDS', 'LOANS']);
    expect(bdt!.lines.every((l) => l.basis === 'RECORDED')).toBe(true);
  });

  it('uses the latest valuation for an investment, rolled forward by later top-ups', () => {
    const fdr = account({
      id: 'fdr',
      type: 'INVESTMENT',
      movements: [
        { date: '2026-01-10', amount: m('10000') },
        { date: '2026-08-01', amount: m('2000') },
      ],
      valuations: [{ date: '2026-06-30', value: m('10800'), source: 'USER_ENTERED' }],
    });
    const [later] = computeNetWorth({ asOf: '2026-09-01', accounts: [fdr], items: [] });
    expect(s(later!.lines[0]!.value)).toBe('12800.00');
    expect(s(later!.lines[0]!.recorded!)).toBe('12000.00');
    expect(later!.lines[0]!.basis).toBe('USER_ENTERED');
    expect(later!.lines[0]!.valuedOn).toBe('2026-06-30');

    const [before] = computeNetWorth({ asOf: '2026-05-01', accounts: [fdr], items: [] });
    expect(s(before!.lines[0]!.value)).toBe('10000.00');
    expect(before!.lines[0]!.basis).toBe('RECORDED');
  });

  it('counts net-worth items from their valuation date until archived', () => {
    const flat: ItemInput = {
      id: 'flat',
      name: 'Flat',
      side: 'ASSET',
      currency: 'BDT',
      archivedOn: '2026-10-01',
      valuations: [{ date: '2026-03-01', value: m('5000000'), source: 'ESTIMATED' }],
    };
    const at = (asOf: string) => computeNetWorth({ asOf, accounts: [], items: [flat] });
    expect(at('2026-02-01')).toEqual([]);
    expect(s(at('2026-06-01')[0]!.assets)).toBe('5000000.00');
    expect(at('2026-06-01')[0]!.lines[0]!.basis).toBe('ESTIMATED');
    expect(at('2026-10-01')).toEqual([]);
  });

  it('never mixes currencies and ignores accounts opened after the date', () => {
    const result = computeNetWorth({
      asOf: '2026-06-01',
      accounts: [
        account({ id: 'bdt', movements: [{ date: '2026-01-01', amount: m('100') }] }),
        account({
          id: 'usd',
          currency: 'USD',
          movements: [{ date: '2026-01-01', amount: m('5') }],
        }),
        account({ id: 'future', openedOn: '2026-07-01' }),
      ],
      items: [],
    });
    expect(result.map((r) => [r.currency, s(r.netWorth)])).toEqual([
      ['BDT', '100.00'],
      ['USD', '5.00'],
    ]);
  });

  it('sums ledger movements up to and including the date', () => {
    const movements = [
      { date: '2026-01-01', amount: m('10') },
      { date: '2026-01-02', amount: money('-3') },
    ];
    expect(s(bookValueAsOf(movements, '2026-01-01'))).toBe('10.00');
    expect(s(bookValueAsOf(movements, '2026-01-02'))).toBe('7.00');
  });

  it('builds month-end history points ending today', () => {
    expect(historyDates('2026-11-07', 3)).toEqual(['2026-09-30', '2026-10-31', '2026-11-07']);
    expect(historyDates('2026-03-15', 2)).toEqual(['2026-02-28', '2026-03-15']);
  });
});
