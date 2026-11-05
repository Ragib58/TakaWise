import {
  InvalidMoneyError,
  money,
  parseMoney,
  parsePositiveMoney,
  sumMoney,
  toMoneyString,
  ZERO,
} from './money';

describe('money', () => {
  it('avoids floating-point drift (0.1 + 0.2)', () => {
    expect(toMoneyString(parseMoney('0.1').plus(parseMoney('0.2')))).toBe('0.3000');
  });

  it('sums many small amounts exactly', () => {
    const values = Array.from({ length: 10_000 }, () => '0.0001');
    expect(toMoneyString(sumMoney(values))).toBe('1.0000');
  });

  it('handles the full NUMERIC(20,4) range without exponent notation', () => {
    const max = parseMoney('9999999999999999.9999');
    expect(toMoneyString(max.plus(max))).toBe('19999999999999999.9998');
  });

  it('formats with the 4-dp storage scale', () => {
    expect(toMoneyString(parseMoney('450'))).toBe('450.0000');
  });

  it('wraps database values (Prisma Decimal / strings)', () => {
    expect(money({ toString: () => '12.5000' }).equals(parseMoney('12.5'))).toBe(true);
  });

  it.each(['-1', '1.23456', 'abc', '1e5', ' ', '1,000'])('rejects %p', (input) => {
    expect(() => parseMoney(input)).toThrow(InvalidMoneyError);
  });

  it('rejects JS numbers at runtime', () => {
    expect(() => parseMoney(0.1 as unknown as string)).toThrow(InvalidMoneyError);
  });

  it('parsePositiveMoney rejects zero but parseMoney allows it', () => {
    expect(parseMoney('0').equals(ZERO)).toBe(true);
    expect(() => parsePositiveMoney('0.0000')).toThrow(/greater than 0/);
  });
});
