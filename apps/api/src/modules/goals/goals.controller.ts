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
  createContributionRequestSchema,
  createGoalRequestSchema,
  type GoalDetailResponse,
  type GoalResponse,
  listGoalsQuerySchema,
  updateGoalRequestSchema,
} from '@takawise/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import {
  IDEMPOTENT_REPLAYED_HEADER,
  IdempotencyKey,
} from '../idempotency/idempotency-key.decorator';
import { GoalsService } from './goals.service';

class CreateGoalDto extends createZodDto(createGoalRequestSchema) {}
class UpdateGoalDto extends createZodDto(updateGoalRequestSchema) {}
class ListGoalsQueryDto extends createZodDto(listGoalsQuerySchema) {}
class CreateContributionDto extends createZodDto(createContributionRequestSchema) {}

const IDEMPOTENCY_HEADER_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated UUID',
};

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListGoalsQueryDto,
  ): Promise<GoalResponse[]> {
    return this.goals.list(auth.userId, query.status);
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateGoalDto,
    @Client() client: ClientContext,
  ): Promise<GoalResponse> {
    return this.goals.create(auth.userId, body, client);
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoalDetailResponse> {
    return this.goals.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateGoalDto,
    @Client() client: ClientContext,
  ): Promise<GoalDetailResponse> {
    return this.goals.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<GoalDetailResponse> {
    return this.goals.archive(auth.userId, id, client);
  }

  @Post(':id/contributions')
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async contribute(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateContributionDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GoalDetailResponse> {
    const result = await this.goals.addContribution(auth.userId, id, body, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Post(':id/contributions/:contributionId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async reverseContribution(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GoalDetailResponse> {
    const result = await this.goals.reverseContribution(
      auth.userId,
      id,
      contributionId,
      key,
      client,
    );
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }
}
