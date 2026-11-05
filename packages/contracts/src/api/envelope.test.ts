import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiErrorEnvelopeSchema,
  buildPaginationMeta,
  MAX_PAGE_SIZE,
  paginatedEnvelopeSchema,
  paginationQuerySchema,
  successEnvelopeSchema,
} from './envelope';

describe('paginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces query-string numbers', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { pageSize: String(MAX_PAGE_SIZE + 1) },
    { page: '1.5' },
  ])('rejects invalid input %o', (input) => {
    expect(paginationQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('buildPaginationMeta', () => {
  it('computes totalPages with ceiling', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 20, total: 135 }, 'r1')).toEqual({
      page: 1,
      pageSize: 20,
      total: 135,
      totalPages: 7,
      requestId: 'r1',
    });
  });

  it('returns zero pages for an empty result', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 20, total: 0 }, 'r1').totalPages).toBe(0);
  });
});

describe('envelope schemas', () => {
  it('accepts a success envelope', () => {
    const schema = successEnvelopeSchema(z.object({ id: z.string() }));
    expect(schema.safeParse({ data: { id: 'a' }, meta: { requestId: 'r' } }).success).toBe(true);
  });

  it('accepts a paginated envelope', () => {
    const schema = paginatedEnvelopeSchema(z.object({ id: z.string() }));
    const meta = buildPaginationMeta({ page: 1, pageSize: 20, total: 1 }, 'r');
    expect(schema.safeParse({ data: [{ id: 'a' }], meta }).success).toBe(true);
  });

  it('rejects unknown error codes', () => {
    const result = apiErrorEnvelopeSchema.safeParse({
      error: { code: 'OOPS', message: 'x', details: [], requestId: 'r' },
    });
    expect(result.success).toBe(false);
  });
});
