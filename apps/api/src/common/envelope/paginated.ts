/**
 * Return this from a controller to produce a paginated envelope:
 * { data: items, meta: { page, pageSize, total, totalPages, requestId } }
 */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly page: number,
    public readonly pageSize: number,
    public readonly total: number,
  ) {}
}
