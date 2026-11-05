import { describe, expect, it } from 'vitest';
import { currencyCodeSchema, moneyAmountOrZeroSchema, moneyAmountSchema } from './money';

describe('moneyAmountSchema', () => {
  it.each(['1', '450.00', '0.0001', '50000', '9999999999999999.9999'])('accepts %s', (v) => {
    expect(moneyAmountSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    ['0', 'zero'],
    ['0.0000', 'zero with scale'],
    ['-5', 'negative'],
    ['1.23456', 'too many decimals'],
    ['01', 'leading zero'],
    ['1e3', 'exponent'],
    ['10000000000000000', '17 integer digits'],
    ['', 'empty'],
    ['1,000', 'grouping separator'],
    ['১০০', 'Bangla digits (client must normalise)'],
  ])('rejects %s (%s)', (v) => {
    expect(moneyAmountSchema.safeParse(v).success).toBe(false);
  });

  it('rejects JSON numbers', () => {
    expect(moneyAmountSchema.safeParse(450).success).toBe(false);
  });
});

describe('moneyAmountOrZeroSchema', () => {
  it('accepts zero', () => {
    expect(moneyAmountOrZeroSchema.parse('0')).toBe('0');
  });
});

describe('currencyCodeSchema', () => {
  it('accepts BDT and rejects lowercase', () => {
    expect(currencyCodeSchema.safeParse('BDT').success).toBe(true);
    expect(currencyCodeSchema.safeParse('bdt').success).toBe(false);
  });
});
