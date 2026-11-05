import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AcceptedResponse,
  type AuthSessionResponse,
  CSRF_HEADER,
  emailOnlyRequestSchema,
  loginRequestSchema,
  REFRESH_COOKIE,
  registerRequestSchema,
  resetPasswordRequestSchema,
  type SessionSummary,
  verifyEmailRequestSchema,
} from '@takawise/contracts';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { type AuthContext, CurrentUser, Public } from './auth.decorators';
import { AuthService, type SignedInSession } from './auth.service';
import { clearSessionCookies, setSessionCookies } from './cookies';
import { CsrfGuard } from './guards/csrf.guard';
import { SessionsService } from './sessions.service';

class RegisterDto extends createZodDto(registerRequestSchema) {}
class VerifyEmailDto extends createZodDto(verifyEmailRequestSchema) {}
class EmailOnlyDto extends createZodDto(emailOnlyRequestSchema) {}
class LoginDto extends createZodDto(loginRequestSchema) {}
class ResetPasswordDto extends createZodDto(resetPasswordRequestSchema) {}

/** Per-IP limits on top of the global default (AUTH-04). Codes also have per-account limits. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };
const EMAIL_SENDING = { default: { limit: 5, ttl: 60_000 } };

function refreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private respond(res: Response, session: SignedInSession): AuthSessionResponse {
    setSessionCookies(res, this.config, session);
    return session.body;
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(
    @Body() body: RegisterDto,
    @Client() client: ClientContext,
  ): Promise<AcceptedResponse> {
    await this.auth.register(body, client);
    return { status: 'verification_required' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    return this.respond(res, await this.auth.verifyEmail(body, client));
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body() body: EmailOnlyDto,
    @Client() client: ClientContext,
  ): Promise<AcceptedResponse> {
    await this.auth.resendVerification(body.email, client);
    return { status: 'email_sent' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    return this.respond(res, await this.auth.login(body, client));
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Throttle(STRICT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async refresh(
    @Req() req: Request,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    try {
      return this.respond(res, await this.auth.refresh(refreshCookie(req), client));
    } catch (error) {
      clearSessionCookies(res, this.config);
      throw error;
    }
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async logout(
    @Req() req: Request,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedResponse> {
    await this.auth.logout(refreshCookie(req), client);
    clearSessionCookies(res, this.config);
    return { status: 'logged_out' };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() auth: AuthContext,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptedResponse> {
    await this.auth.logoutAll(auth.userId, client);
    clearSessionCookies(res, this.config);
    return { status: 'logged_out' };
  }

  @Public()
  @Throttle(EMAIL_SENDING)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() body: EmailOnlyDto,
    @Client() client: ClientContext,
  ): Promise<AcceptedResponse> {
    await this.auth.forgotPassword(body.email, client);
    return { status: 'email_sent' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Client() client: ClientContext,
  ): Promise<AcceptedResponse> {
    await this.auth.resetPassword(body, client);
    return { status: 'password_reset' };
  }

  @ApiBearerAuth()
  @Get('sessions')
  listSessions(@CurrentUser() auth: AuthContext): Promise<SessionSummary[]> {
    return this.sessions.listActive(auth.userId, auth.sessionId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AcceptedResponse> {
    await this.sessions.revokeOwned(auth.userId, id);
    return { status: 'ok' };
  }
}
