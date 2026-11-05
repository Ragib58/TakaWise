import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { sha256Hex } from '../auth/crypto/secure-tokens';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Stable JSON: object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export type IdempotentResult<T> = { body: T; replayed: boolean };

/**
 * Replay protection for financial commands (ADR-006). The key row is written in
 * the SAME database transaction as the posting, so either both exist or neither:
 *  - same key + same request  → the stored response, nothing new is written
 *  - same key + other request → 422 IDEMPOTENCY_MISMATCH
 *  - concurrent duplicates    → one commits; the other hits the primary key,
 *                               rolls back entirely and returns the winner's response
 * Failed commands store nothing, so the client may retry with the same key.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T extends Prisma.InputJsonValue>(args: {
    userId: string;
    key: string;
    scope: string;
    request: unknown;
    responseStatus: number;
    run: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<IdempotentResult<T>> {
    const requestHash = sha256Hex(`${args.scope}\n${canonicalJson(args.request)}`);

    const existing = await this.replay<T>(args.userId, args.key, args.scope, requestHash);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.idempotencyKey.deleteMany({
          where: { userId: args.userId, key: args.key, expiresAt: { lte: now } },
        });
        const body = await args.run(tx);
        await tx.idempotencyKey.create({
          data: {
            userId: args.userId,
            key: args.key,
            scope: args.scope,
            requestHash,
            responseStatus: args.responseStatus,
            responseBody: body,
            createdAt: now,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
        return { body, replayed: false };
      });
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint && /idempotency_keys|user_id,key/.test(constraint)) {
        const winner = await this.replay<T>(args.userId, args.key, args.scope, requestHash);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async replay<T>(
    userId: string,
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<IdempotentResult<T> | null> {
    const row = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!row || row.expiresAt <= new Date()) return null;
    if (row.scope !== scope || row.requestHash !== requestHash) {
      throw new AppException(
        'IDEMPOTENCY_MISMATCH',
        'This Idempotency-Key was already used with a different request.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { body: row.responseBody as T, replayed: true };
  }
}
