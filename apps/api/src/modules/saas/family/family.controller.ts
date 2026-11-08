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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acceptInvitationRequestSchema,
  changeMemberRoleRequestSchema,
  createShareRequestSchema,
  createWorkspaceRequestSchema,
  inviteMemberRequestSchema,
  renameWorkspaceRequestSchema,
  type SharedResource,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../../auth/auth.decorators';
import { FamilyService } from './family.service';

class CreateWorkspaceDto extends createZodDto(createWorkspaceRequestSchema) {}
class RenameWorkspaceDto extends createZodDto(renameWorkspaceRequestSchema) {}
class InviteDto extends createZodDto(inviteMemberRequestSchema) {}
class AcceptDto extends createZodDto(acceptInvitationRequestSchema) {}
class RoleDto extends createZodDto(changeMemberRoleRequestSchema) {}
class ShareDto extends createZodDto(createShareRequestSchema) {}

const uuid = new ParseUUIDPipe();

@ApiTags('family')
@ApiBearerAuth()
@Controller('family')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get('workspaces')
  list(@CurrentUser() auth: AuthContext): Promise<WorkspaceSummary[]> {
    return this.family.list(auth.userId);
  }

  @Post('workspaces')
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateWorkspaceDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.create(auth.userId, body.name, client);
  }

  @Get('workspaces/:id')
  detail(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<WorkspaceDetail> {
    return this.family.detail(auth.userId, id);
  }

  @Patch('workspaces/:id')
  rename(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: RenameWorkspaceDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.rename(auth.userId, id, body.name, client);
  }

  @Delete('workspaces/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientContext,
  ): Promise<void> {
    return this.family.remove(auth.userId, id, client);
  }

  @Post('workspaces/:id/invitations')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  invite(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: InviteDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.invite(auth.userId, id, body, client);
  }

  @Delete('workspaces/:id/invitations/:invitationId')
  revokeInvitation(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.revokeInvitation(auth.userId, id, invitationId, client);
  }

  /** Brute force is impractical (≈50-bit code bound to the invitee's e-mail) and throttled. */
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  accept(
    @CurrentUser() auth: AuthContext,
    @Body() body: AcceptDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.accept(auth.userId, body.code, client);
  }

  @Delete('workspaces/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) target: string,
    @Client() client: ClientContext,
  ): Promise<void> {
    return this.family.removeMember(auth.userId, id, target, client);
  }

  @Patch('workspaces/:id/members/:userId')
  changeRole(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) target: string,
    @Body() body: RoleDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.changeRole(auth.userId, id, target, body.role, client);
  }

  @Post('workspaces/:id/shares')
  share(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: ShareDto,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.share(auth.userId, id, body, client);
  }

  @Delete('workspaces/:id/shares/:shareId')
  unshare(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('shareId', uuid) shareId: string,
    @Client() client: ClientContext,
  ): Promise<WorkspaceDetail> {
    return this.family.unshare(auth.userId, id, shareId, client);
  }

  @Get('workspaces/:id/shared')
  shared(
    @CurrentUser() auth: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<SharedResource[]> {
    return this.family.shared(auth.userId, id);
  }
}
