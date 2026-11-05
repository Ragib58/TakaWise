import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorDetail } from '@takawise/contracts';

/**
 * Domain/application error with an explicit API error code and a message that is
 * safe to show to end users. Prefer this over raw HttpException in feature code.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details: ApiErrorDetail[] = [],
  ) {
    super(message, status);
    this.name = 'AppException';
  }
}
