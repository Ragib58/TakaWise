import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER } from '@takawise/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';

const keySchema = z.uuid();

/** Required `Idempotency-Key: <uuid>` header for financial commands (ADR-006). */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const value = ctx.switchToHttp().getRequest<Request>().get(IDEMPOTENCY_KEY_HEADER);
  const parsed = keySchema.safeParse(value?.trim());
  if (!parsed.success) {
    throw new AppException(
      'VALIDATION_ERROR',
      'Please check the submitted fields.',
      HttpStatus.BAD_REQUEST,
      [{ field: 'Idempotency-Key', message: 'A UUID Idempotency-Key header is required' }],
    );
  }
  return parsed.data.toLowerCase();
});

export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
