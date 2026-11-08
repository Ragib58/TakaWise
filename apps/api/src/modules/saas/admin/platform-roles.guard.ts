import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@takawise/contracts';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthenticatedRequest } from '../../auth/auth.decorators';

export const PLATFORM_ROLES = 'takawise:platform-roles';

/** Staff roles allowed on a controller or handler (handler wins). */
export const StaffRoles = (...roles: Array<Exclude<PlatformRole, 'NONE'>>) =>
  SetMetadata(PLATFORM_ROLES, roles);

/**
 * Admin route group guard (ADR-027). Runs after the global JwtAuthGuard and
 * reads the role from the database on every request, so a demotion takes
 * effect immediately. Customers get 403 without learning anything more.
 */
@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(PLATFORM_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return false; // deny by default
    const userId = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.userId;
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } })
      : null;
    if (!user || !roles.includes(user.platformRole)) {
      throw new AppException(
        'FORBIDDEN',
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
