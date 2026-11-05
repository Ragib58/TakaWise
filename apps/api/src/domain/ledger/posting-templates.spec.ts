import { dateOnly, localDateOf, toIsoDate } from '../time/local-date';
import { parseMoney, toMoneyString } from '../money/money';
import { balanceOf, validateJournalLines } from './ledger-rules';
import {
  expenseLines,
  incomeLines,
  openingBalanceLines,
  type PostingLine,
  reversalLines,
  transferLines,
} from './posting-templates';

const m = parseMoney;
const linesFor = (lines: PostingLine[], id: string) =>
  lines.filter((l) => l.ledgerAccountId === id);

describe('posting templates', () => {
  const all: Array<[string, PostingLine[]]> = [
    [
      'opening asset',
      openingBalanceLines({
        accountClass: 'ASSET',
        accountLedgerId: 'cash',
        openingEquityLedgerId: 'eq',
        amount: m('1000'),
      }),
    ],
    [
      'opening card',
      openingBalanceLines({
        accountClass: 'LIABILITY',
        accountLedgerId: 'card',
        openingEquityLedgerId: 'eq',
        amount: m('2500'),
      }),
    ],
    ['income', incomeLines('bank', 'inc', m('50000'))],
    ['expense', expenseLines('exp', 'cash', m('500'))],
    ['transfer', transferLines('cash', 'bank', m('5000'))],
  ];

  it.each(all)('%s is balanced', (_name, lines) => {
    expect(validateJournalLines(lines)).toEqual([]);
  });

  it.each(all)('%s reversal is balanced and nets every account to zero', (_name, lines) => {
    const reversal = reversalLines(lines);
    expect(validateJournalLines(reversal)).toEqual([]);
    for (const id of new Set(lines.map((l) => l.ledgerAccountId))) {
      expect(balanceOf('DEBIT', [...linesFor(lines, id), ...linesFor(reversal, id)]).isZero()).toBe(
        true,
      );
    }
  });

  it('blueprint §6.5: salary to bank increases the bank and income balances', () => {
    const lines = incomeLines('bank', 'inc', m('50000'));
    expect(toMoneyString(balanceOf('DEBIT', linesFor(lines, 'bank')))).toBe('50000.0000');
    expect(toMoneyString(balanceOf('CREDIT', linesFor(lines, 'inc')))).toBe('50000.0000');
  });

  it('a card expense increases what is owed; an asset opening increases what is held', () => {
    expect(
      toMoneyString(balanceOf('CREDIT', linesFor(expenseLines('exp', 'card', m('2000')), 'card'))),
    ).toBe('2000.0000');
    const opening = openingBalanceLines({
      accountClass: 'LIABILITY',
      accountLedgerId: 'card',
      openingEquityLedgerId: 'eq',
      amount: m('2500'),
    });
    expect(toMoneyString(balanceOf('CREDIT', linesFor(opening, 'card')))).toBe('2500.0000');
  });

  it('a transfer never touches income or expense accounts (TRX-03)', () => {
    const ids = transferLines('cash', 'bank', m('5000')).map((l) => l.ledgerAccountId);
    expect(ids.sort()).toEqual(['bank', 'cash']);
  });
});

describe('local effective dates (ADR-012)', () => {
  it.each([
    ['2026-11-05T17:59:59Z', '2026-11-05'],
    ['2026-11-05T18:00:00Z', '2026-11-06'], // midnight in Dhaka
    ['2026-11-05T12:30:00+06:00', '2026-11-05'],
    ['2026-12-31T20:00:00Z', '2027-01-01'],
  ])('%s is %s in Asia/Dhaka', (instant, expected) => {
    expect(localDateOf(new Date(instant), 'Asia/Dhaka')).toBe(expected);
  });

  it('respects other time zones', () => {
    expect(localDateOf(new Date('2026-11-05T02:00:00Z'), 'America/New_York')).toBe('2026-11-04');
  });

  it('round-trips DATE values', () => {
    expect(toIsoDate(dateOnly('2026-02-28'))).toBe('2026-02-28');
    expect(() => dateOnly('2026-2-8')).toThrow();
  });
});
