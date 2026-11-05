import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { AccessTokenService } from '../access-token.service';
import { type AuthenticatedRequest, IS_PUBLIC } from '../auth.decorators';

/**
 * Global guard (ADR-013): every route requires a valid access token unless it is
 * marked @Public(). The token's session is checked on every request, so revoking
 * a session (logout, password reset, reuse detection) takes effect immediately
 * rather than when the access token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
    const claims = token ? this.tokens.verify(token) : null;
    if (!claims) throw unauthenticated();

    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { user: { select: { status: true } } },
    });
    if (!session || session.user.status !== 'ACTIVE') throw unauthenticated();

    req.auth = { userId: claims.userId, sessionId: claims.sessionId };
    return true;
  }
}

function unauthenticated(): AppException {
  return new AppException(
    'UNAUTHENTICATED',
    'Authentication is required.',
    HttpStatus.UNAUTHORIZED,
  );
}
