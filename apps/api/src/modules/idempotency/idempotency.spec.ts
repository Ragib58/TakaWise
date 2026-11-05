import { canonicalJson } from './idempotency.service';

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
  });

  it('distinguishes different values and array order', () => {
    expect(canonicalJson({ amount: '450.00' })).not.toBe(canonicalJson({ amount: '450.01' }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('ignores undefined properties like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});
