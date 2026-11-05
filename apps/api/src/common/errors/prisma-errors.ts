/**
 * Helpers for recognising database errors that surface through Prisma 7's
 * driver adapter, so services can map them to friendly API errors.
 */
type MaybePrismaError = {
  code?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } };
  };
};

/** Name (index) or fields of the unique constraint that was violated, else null. */
export function uniqueViolation(error: unknown): string | null {
  const e = error as MaybePrismaError | null;
  if (!e || e.code !== 'P2002') return null;
  const constraint = e.meta?.driverAdapterError?.cause?.constraint;
  if (constraint?.index) return constraint.index;
  if (constraint?.fields) return constraint.fields.join(',');
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.join(',');
  return typeof target === 'string' ? target : 'unknown';
}
