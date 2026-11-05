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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type BudgetResponse,
  createBudgetRequestSchema,
  listBudgetsQuerySchema,
  updateBudgetRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { BudgetsService } from './budgets.service';

class CreateBudgetDto extends createZodDto(createBudgetRequestSchema) {}
class UpdateBudgetDto extends createZodDto(updateBudgetRequestSchema) {}
class ListBudgetsQueryDto extends createZodDto(listBudgetsQuerySchema) {}

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListBudgetsQueryDto,
  ): Promise<BudgetResponse[]> {
    return this.budgets.list(auth.userId, query);
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateBudgetDto,
    @Client() client: ClientContext,
  ): Promise<BudgetResponse> {
    return this.budgets.create(auth.userId, body, client);
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponse> {
    return this.budgets.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBudgetDto,
    @Client() client: ClientContext,
  ): Promise<BudgetResponse> {
    return this.budgets.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<BudgetResponse> {
    return this.budgets.setArchived(auth.userId, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<BudgetResponse> {
    return this.budgets.setArchived(auth.userId, id, false, client);
  }
}
