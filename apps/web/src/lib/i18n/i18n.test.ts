import { describe, expect, it } from 'vitest';
import { bn, en } from './messages';
import { translate } from './use-t';

describe('i18n messages', () => {
  it('Bangla covers every English key with non-empty Bengali text', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(bn)) {
      expect(value.trim(), key).not.toBe('');
    }
    expect(bn['nav.dashboard']).toMatch(/[ঀ-৿]/);
  });

  it('keeps placeholders consistent between languages', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(bn[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('interpolates variables', () => {
    expect(translate('en', 'dashboard.vsLastMonth', { amount: '৳100.00' })).toBe(
      'Last month: ৳100.00',
    );
    expect(translate('bn', 'dashboard.itemsOver', { count: 2 })).toBe(
      '2টি ক্যাটাগরির সীমা পার হয়েছে',
    );
  });
});
