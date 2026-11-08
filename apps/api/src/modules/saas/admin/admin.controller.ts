import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type AdminAnalyticsResponse,
  type AdminTicketResponse,
  type AdminUserResponse,
  featureFlagKeySchema,
  grantSubscriptionRequestSchema,
  planCodeSchema,
  type PlanResponse,
  setRoleRequestSchema,
  subscriptionStatusSchema,
  ticketMessageRequestSchema,
  ticketStatusSchema,
  updateFlagRequestSchema,
  updatePlanRequestSchema,
  updateTicketRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Client, type ClientContext } from '../../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../../auth/auth.decorators';
import { SupportService } from '../support/support.service';
import { AdminService } from './admin.service';
import { PlatformRolesGuard, StaffRoles } from './platform-roles.guard';

class UpdatePlanDto extends createZodDto(updatePlanRequestSchema) {}
class GrantDto extends createZodDto(grantSubscriptionRequestSchema) {}
class RoleDto extends createZodDto(setRoleRequestSchema) {}
class FlagDto extends createZodDto(updateFlagRequestSchema) {}
class TicketMessageDto extends createZodDto(ticketMessageRequestSchema) {}
class TicketStatusDto extends createZodDto(updateTicketRequestSchema) {}
class PlanParamDto extends createZodDto(z.strictObject({ code: planCodeSchema })) {}
class FlagParamDto extends createZodDto(z.strictObject({ key: featureFlagKeySchema })) {}
class UserQueryDto extends createZodDto(z.strictObject({ email: z.email().max(254) })) {}
class SubsQueryDto extends createZodDto(
  z.strictObject({ status: subscriptionStatusSchema.optional() }),
) {}
class TicketsQueryDto extends createZodDto(
  z.strictObject({ status: ticketStatusSchema.optional() }),
) {}

const uuid = new ParseUUIDPipe();

/**
 * /admin route group (ADR-027). Staff only: SUPPORT for tickets and limited
 * account metadata, ADMIN additionally for plans, subscriptions, roles,
 * flags and analytics. No endpoint here returns financial content.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(PlatformRolesGuard)
@StaffRoles('SUPPORT', 'ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly support: SupportService,
  ) {}

  @Get('me')
  async me(@CurrentUser() auth: AuthContext) {
    return { role: await this.admin.role(auth.userId) };
  }

  // ── Users (limited metadata) ──

  @Get('users')
  findUser(@Query() q: UserQueryDto): Promise<AdminUserResponse> {
    return this.admin.findByEmail(q.email);
  }

  @Get('users/:id')
  user(@Param('id', uuid) id: string): Promise<AdminUserResponse> {
    return this.admin.user(id);
  }

  @Patch('users/:id/role')
  @StaffRoles('ADMIN')
  setRole(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: RoleDto,
    @Client() client: ClientContext,
  ): Promise<AdminUserResponse> {
    return this.admin.setRole(auth.userId, id, body.role, client);
  }

  @Post('users/:id/subscription')
  @StaffRoles('ADMIN')
  grant(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: GrantDto,
    @Client() client: ClientContext,
  ): Promise<AdminUserResponse> {
    return this.admin.grant(auth.userId, id, body, client);
  }

  @Delete('users/:id/subscription')
  @StaffRoles('ADMIN')
  cancel(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientContext,
  ): Promise<AdminUserResponse> {
    return this.admin.cancelSubscription(auth.userId, id, client);
  }

  // ── Plans, subscriptions, flags, analytics (ADMIN) ──

  @Get('plans')
  @StaffRoles('ADMIN')
  plans(): Promise<PlanResponse[]> {
    return this.admin.plans();
  }

  @Patch('plans/:code')
  @StaffRoles('ADMIN')
  updatePlan(
    @CurrentUser() auth: AuthContext,
    @Param() params: PlanParamDto,
    @Body() body: UpdatePlanDto,
    @Client() client: ClientContext,
  ): Promise<PlanResponse> {
    return this.admin.updatePlan(auth.userId, params.code, body, client);
  }

  @Get('subscriptions')
  @StaffRoles('ADMIN')
  subscriptions(@Query() q: SubsQueryDto) {
    return this.admin.subscriptions(q.status);
  }

  @Get('feature-flags')
  @StaffRoles('ADMIN')
  flags() {
    return this.admin.flags();
  }

  @Patch('feature-flags/:key')
  @StaffRoles('ADMIN')
  setFlag(
    @CurrentUser() auth: AuthContext,
    @Param() params: FlagParamDto,
    @Body() body: FlagDto,
    @Client() client: ClientContext,
  ) {
    return this.admin.setFlag(auth.userId, params.key, body.enabled, client);
  }

  @Get('analytics')
  @StaffRoles('ADMIN')
  analytics(): Promise<AdminAnalyticsResponse> {
    return this.admin.analytics();
  }

  // ── Support tickets (SUPPORT + ADMIN) ──

  @Get('tickets')
  tickets(@Query() q: TicketsQueryDto): Promise<AdminTicketResponse[]> {
    return this.support.listAll(q.status);
  }

  @Get('tickets/:id')
  ticket(@Param('id', uuid) id: string): Promise<AdminTicketResponse> {
    return this.support.getAny(id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.OK)
  replyTicket(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TicketMessageDto,
    @Client() client: ClientContext,
  ): Promise<AdminTicketResponse> {
    return this.support.replyAsStaff(auth.userId, id, body.body, client);
  }

  @Patch('tickets/:id')
  setTicketStatus(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TicketStatusDto,
    @Client() client: ClientContext,
  ): Promise<AdminTicketResponse> {
    return this.support.setStatus(auth.userId, id, body.status, client);
  }
}
