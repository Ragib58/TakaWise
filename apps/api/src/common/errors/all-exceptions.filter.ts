import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorCode, ApiErrorDetail, ApiErrorEnvelope } from '@takawise/contracts';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { getRequestId } from '../request-id';
import { AppException } from './app.exception';

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  BAD_REQUEST: 'The request could not be processed.',
  VALIDATION_ERROR: 'Please check the submitted fields.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  IDEMPOTENCY_MISMATCH: 'This Idempotency-Key was already used with a different request.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  EMAIL_NOT_VERIFIED: 'Please verify your email address first.',
  ACCOUNT_DISABLED: 'This account is not active. Please contact support.',
  INVALID_OR_EXPIRED_CODE: 'The code is invalid or has expired. Request a new one.',
  WEAK_PASSWORD: 'Choose a stronger password.',
  CSRF_FAILED: 'The request could not be verified. Please refresh and try again.',
  FEATURE_DISABLED: 'This feature is not available.',
  AI_CONSENT_REQUIRED: 'Please review and accept the AI data notice first.',
  AI_LIMIT_REACHED: 'You have reached your AI usage limit. Please try again later.',
  AI_UNAVAILABLE: 'The AI assistant is temporarily unavailable. Nothing was saved.',
  AI_OUTPUT_INVALID: 'The AI assistant could not produce a reliable answer. Nothing was saved.',
  UNSUPPORTED_MEDIA_TYPE: 'This file type is not supported.',
};

export function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

function zodDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    return field ? { field, message: issue.message } : { message: issue.message };
  });
}

/**
 * What may be logged about an unexpected error. Prisma error messages can echo
 * query arguments (amounts, descriptions, emails), so for those only the error
 * class, code and model are kept (NFR: redact sensitive payloads).
 */
export function sanitizeForLog(exception: unknown): {
  name: string;
  message: string;
  code?: string;
  model?: string;
  stack?: string;
} {
  if (!(exception instanceof Error)) return { name: 'NonError', message: 'Non-error thrown' };
  if (exception.name.startsWith('PrismaClient') || exception.name === 'DriverAdapterError') {
    const e = exception as Error & { code?: unknown; meta?: { modelName?: unknown } };
    return {
      name: exception.name,
      message: 'Database error (details redacted)',
      code: typeof e.code === 'string' ? e.code : undefined,
      model: typeof e.meta?.modelName === 'string' ? e.meta.modelName : undefined,
    };
  }
  return { name: exception.name, message: exception.message.slice(0, 500), stack: exception.stack };
}

/** Errors thrown by Express middleware (e.g. body-parser) carry a numeric status. */
function middlewareStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value < 600 ? value : undefined;
}

/**
 * Single place that turns any thrown value into the standard error envelope.
 * Internal error messages are never leaked to clients; they are logged instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = getRequestId(req);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = DEFAULT_MESSAGES.INTERNAL_ERROR;
    let details: ApiErrorDetail[] = [];

    if (exception instanceof ZodValidationException) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = DEFAULT_MESSAGES.VALIDATION_ERROR;
      const zodError = exception.getZodError();
      details = zodError instanceof ZodError ? zodDetails(zodError) : [];
    } else if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      message = DEFAULT_MESSAGES[code];
    } else {
      const mwStatus = middlewareStatus(exception);
      if (mwStatus !== undefined && mwStatus < 500) {
        status = mwStatus;
        code = codeForStatus(status);
        message = DEFAULT_MESSAGES[code];
      }
    }

    if (status >= 500) {
      const err = sanitizeForLog(exception);
      this.logger.error({ err, requestId }, err.message);
    }

    if (res.headersSent) return;

    const body: ApiErrorEnvelope = { error: { code, message, details, requestId } };
    res.status(status).json(body);
  }
}
