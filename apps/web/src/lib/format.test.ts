import { describe, expect, it } from 'vitest';
import { currentMonth, formatMoney, formatMonth, shiftMonth } from './format';

describe('formatMoney', () => {
  it('formats BDT with the taka sign', () => {
    expect(formatMoney('1234567.5000', 'BDT')).toBe('৳1,234,567.50');
    expect(formatMoney('-300.0000', 'BDT')).toBe('-৳300.00');
  });

  it('uses Bangla digits and lakh grouping for bn', () => {
    expect(formatMoney('1234567.5000', 'BDT', 'bn')).toBe('১২,৩৪,৫৬৭.৫০৳');
  });

  it('formats huge amounts exactly (no float rounding)', () => {
    expect(formatMoney('9999999999999999.9900', 'BDT')).toBe('৳9,999,999,999,999,999.99');
  });
});

describe('months', () => {
  it('formats and shifts months across year boundaries', () => {
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('computes the current month in Dhaka', () => {
    expect(currentMonth('Asia/Dhaka', new Date('2026-10-31T18:30:00Z'))).toBe('2026-11');
  });
});
