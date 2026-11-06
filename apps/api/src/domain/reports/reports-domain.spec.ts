import { CSV_BOM, csvCell, csvRow } from './csv';
import { daysBetween, monthsBetween, previousMonth } from './periods';

describe('CSV encoding (formula injection)', () => {
  it.each([
    ['=HYPERLINK("http://evil.example","x")', `"'=HYPERLINK(""http://evil.example"",""x"")"`],
    ['+1+1', `"'+1+1"`],
    ['-2+3', `"'-2+3"`],
    ['@SUM(A1:A2)', `"'@SUM(A1:A2)"`],
    ['\tcmd', `"'\tcmd"`],
    ['\r=1', `"'\r=1"`],
  ])('neutralises %p', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('quotes plain values and doubles embedded quotes', () => {
    expect(csvCell('Lunch, "biryani"')).toBe('"Lunch, ""biryani"""');
    expect(csvCell('৪৫০ টাকা')).toBe('"৪৫০ টাকা"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('450.0000')).toBe('"450.0000"');
  });

  it('builds CRLF rows and exposes a BOM', () => {
    expect(csvRow(['a', 'b'])).toBe('"a","b"\r\n');
    expect(CSV_BOM).toBe('﻿');
  });
});

describe('report periods', () => {
  it('lists months inclusively across years', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2026-05', '2026-05')).toEqual(['2026-05']);
  });

  it('finds the previous month', () => {
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(previousMonth('2026-11')).toBe('2026-10');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
    expect(daysBetween('2026-11-05', '2026-11-05')).toBe(1);
  });
});
