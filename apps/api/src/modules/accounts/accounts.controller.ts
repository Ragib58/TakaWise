import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  type AccountResponse,
  createAccountRequestSchema,
  listAccountsQuerySchema,
  updateAccountRequestSchema,
} from '@takawise/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import {
  IDEMPOTENT_REPLAYED_HEADER,
  IdempotencyKey,
} from '../idempotency/idempotency-key.decorator';
import { AccountsService } from './accounts.service';

class CreateAccountDto extends createZodDto(createAccountRequestSchema) {}
class UpdateAccountDto extends createZodDto(updateAccountRequestSchema) {}
class ListAccountsQueryDto extends createZodDto(listAccountsQuerySchema) {}

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListAccountsQueryDto,
  ): Promise<AccountResponse[]> {
    return this.accounts.list(auth.userId, query.status);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated UUID' })
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateAccountDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountResponse> {
    const result = await this.accounts.create(auth.userId, body, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponse> {
    return this.accounts.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAccountDto,
    @Client() client: ClientContext,
  ): Promise<AccountResponse> {
    return this.accounts.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<AccountResponse> {
    return this.accounts.setArchived(auth.userId, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<AccountResponse> {
    return this.accounts.setArchived(auth.userId, id, false, client);
  }
}
