import { parseMoney, toMoneyString, ZERO } from '../money/money';
import {
  balanceOf,
  ledgerClassForAccountType,
  normalBalanceFor,
  SYSTEM_LEDGER_ACCOUNTS,
  validateJournalLines,
} from './ledger-rules';

const m = parseMoney;

describe('normal balance rules', () => {
  it.each([
    ['ASSET', 'DEBIT'],
    ['EXPENSE', 'DEBIT'],
    ['LIABILITY', 'CREDIT'],
    ['EQUITY', 'CREDIT'],
    ['INCOME', 'CREDIT'],
  ] as const)('%s is %s-normal', (cls, normal) => {
    expect(normalBalanceFor(cls)).toBe(normal);
  });

  it('maps credit cards and borrowed loans to LIABILITY and everything else to ASSET', () => {
    expect(ledgerClassForAccountType('CREDIT_CARD_TRACKING')).toBe('LIABILITY');
    expect(ledgerClassForAccountType('LOAN')).toBe('LIABILITY');
    for (const type of [
      'CASH',
      'BANK',
      'MOBILE_WALLET',
      'SAVINGS',
      'OTHER',
      'INVESTMENT',
      'LOAN_RECEIVABLE',
    ] as const) {
      expect(ledgerClassForAccountType(type)).toBe('ASSET');
    }
  });

  it('system ledger accounts match the class rules', () => {
    expect(SYSTEM_LEDGER_ACCOUNTS.map((a) => a.code).sort()).toEqual([
      'EQUITY_OPENING_BALANCE',
      'EXPENSE',
      'INCOME',
    ]);
  });
});

describe('balanceOf (blueprint §6.5 examples)', () => {
  it('cash: opening 1,000, food expense 500 → 500', () => {
    const cash = [
      { debit: '1000', credit: '0' }, // opening
      { debit: '0', credit: '500' }, // food expense
    ];
    expect(toMoneyString(balanceOf('DEBIT', cash))).toBe('500.0000');
  });

  it('bank: salary 50,000 then transfer in 5,000 → 55,000', () => {
    const bank = [
      { debit: '50000', credit: '0' },
      { debit: '5000', credit: '0' },
    ];
    expect(toMoneyString(balanceOf('DEBIT', bank))).toBe('55000.0000');
  });

  it('credit card (liability): expense 2,000 then payment 1,500 → owes 500', () => {
    const card = [
      { debit: '0', credit: '2000' },
      { debit: '1500', credit: '0' },
    ];
    expect(toMoneyString(balanceOf('CREDIT', card))).toBe('500.0000');
  });

  it('income account grows with credits', () => {
    expect(toMoneyString(balanceOf('CREDIT', [{ debit: '0', credit: '50000' }]))).toBe(
      '50000.0000',
    );
  });

  it('empty account has zero balance', () => {
    expect(balanceOf('DEBIT', []).equals(ZERO)).toBe(true);
  });
});

describe('validateJournalLines', () => {
  it('accepts a balanced two-line journal', () => {
    expect(
      validateJournalLines([
        { debit: m('500'), credit: ZERO },
        { debit: ZERO, credit: m('500') },
      ]),
    ).toEqual([]);
  });

  it('accepts a balanced multi-line journal', () => {
    expect(
      validateJournalLines([
        { debit: m('300'), credit: ZERO },
        { debit: m('200'), credit: ZERO },
        { debit: ZERO, credit: m('500') },
      ]),
    ).toEqual([]);
  });

  it('flags an unbalanced journal', () => {
    expect(
      validateJournalLines([
        { debit: m('500'), credit: ZERO },
        { debit: ZERO, credit: m('499.9999') },
      ]),
    ).toEqual(['UNBALANCED']);
  });

  it('flags a single line', () => {
    expect(validateJournalLines([{ debit: m('1'), credit: ZERO }])).toEqual(
      expect.arrayContaining(['TOO_FEW_LINES', 'UNBALANCED']),
    );
  });

  it('flags a line with both sides', () => {
    expect(
      validateJournalLines([
        { debit: m('5'), credit: m('5') },
        { debit: m('5'), credit: m('5') },
      ]),
    ).toEqual(['LINE_NOT_ONE_SIDED']);
  });

  it('flags zero lines', () => {
    expect(
      validateJournalLines([
        { debit: ZERO, credit: ZERO },
        { debit: ZERO, credit: ZERO },
      ]),
    ).toEqual(['LINE_NOT_POSITIVE']);
  });

  it('flags negative amounts', () => {
    expect(
      validateJournalLines([
        { debit: m('5').negated(), credit: ZERO },
        { debit: ZERO, credit: m('5').negated() },
      ]),
    ).toContain('LINE_NOT_POSITIVE');
  });

  it('randomised: balanced generators always pass, perturbed ones always fail', () => {
    for (let i = 0; i < 200; i += 1) {
      const n = 1 + Math.floor(Math.random() * 5);
      const debits = Array.from({ length: n }, () =>
        m((Math.floor(Math.random() * 1e8) + 1).toString()).div(10_000),
      );
      const total = debits.reduce((a, b) => a.plus(b), ZERO);
      const lines = [
        ...debits.map((d) => ({ debit: d, credit: ZERO })),
        { debit: ZERO, credit: total },
      ];
      expect(validateJournalLines(lines)).toEqual([]);

      const perturbed = [...lines.slice(0, -1), { debit: ZERO, credit: total.plus(m('0.0001')) }];
      expect(validateJournalLines(perturbed)).toEqual(['UNBALANCED']);
    }
  });
});
