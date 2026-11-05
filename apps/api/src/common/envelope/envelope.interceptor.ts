import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  buildPaginationMeta,
  type PaginatedEnvelope,
  type SuccessEnvelope,
} from '@takawise/contracts';
import { map, type Observable } from 'rxjs';
import { getRequestId } from '../request-id';
import { Paginated } from './paginated';
import { SKIP_ENVELOPE } from './skip-envelope.decorator';

/** Wraps every successful JSON response in the standard envelope (blueprint §8). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const requestId = getRequestId(context.switchToHttp().getRequest());

    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof Paginated) {
          return {
            data: value.items as unknown[],
            meta: buildPaginationMeta(value, requestId),
          } satisfies PaginatedEnvelope<unknown>;
        }
        return { data: value ?? null, meta: { requestId } } satisfies SuccessEnvelope<unknown>;
      }),
    );
  }
}
