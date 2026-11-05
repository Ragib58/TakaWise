import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type AcceptedResponse,
  changePasswordRequestSchema,
  type MeResponse,
  updateMeRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { UsersService } from './users.service';

class UpdateMeDto extends createZodDto(updateMeRequestSchema) {}
class ChangePasswordDto extends createZodDto(changePasswordRequestSchema) {}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser() auth: AuthContext): Promise<MeResponse> {
    return this.users.getMe(auth.userId);
  }

  @Patch()
  updateMe(
    @CurrentUser() auth: AuthContext,
    @Body() body: UpdateMeDto,
    @Client() client: ClientContext,
  ): Promise<MeResponse> {
    return this.users.updateMe(auth.userId, body, client);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() auth: AuthContext,
    @Body() body: ChangePasswordDto,
    @Client() client: ClientContext,
  ): Promise<AcceptedResponse> {
    await this.users.changePassword(auth, body, client);
    return { status: 'ok' };
  }
}
