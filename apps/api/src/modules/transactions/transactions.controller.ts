import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  createTransactionRequestSchema,
  createTransferRequestSchema,
  listTransactionsQuerySchema,
  listTransfersQuerySchema,
  type PostedTransactionResponse,
  reverseRequestSchema,
  type TransactionResponse,
  type TransferResponse,
} from '@takawise/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import type { Paginated } from '../../common/envelope/paginated';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import type { IdempotentResult } from '../idempotency/idempotency.service';
import {
  IDEMPOTENT_REPLAYED_HEADER,
  IdempotencyKey,
} from '../idempotency/idempotency-key.decorator';
import { TransactionsService } from './transactions.service';
import { TransfersService } from './transfers.service';

class CreateTransactionDto extends createZodDto(createTransactionRequestSchema) {}
class ListTransactionsQueryDto extends createZodDto(listTransactionsQuerySchema) {}
class ReverseDto extends createZodDto(reverseRequestSchema) {}
class CreateTransferDto extends createZodDto(createTransferRequestSchema) {}
class ListTransfersQueryDto extends createZodDto(listTransfersQuerySchema) {}

const IDEMPOTENCY_HEADER_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated UUID',
};

function unwrap<T>(res: Response, result: IdempotentResult<T>): T {
  if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
  return result.body;
}

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Paginated<TransactionResponse>> {
    return this.transactions.list(auth.userId, query);
  }

  @Post()
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateTransactionDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PostedTransactionResponse> {
    return unwrap(res, await this.transactions.create(auth.userId, body, key, client));
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionResponse> {
    return this.transactions.get(auth.userId, id);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async reverse(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReverseDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PostedTransactionResponse> {
    return unwrap(res, await this.transactions.reverse(auth.userId, id, body, key, client));
  }
}

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListTransfersQueryDto,
  ): Promise<Paginated<TransferResponse>> {
    return this.transfers.list(auth.userId, query);
  }

  @Post()
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateTransferDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferResponse> {
    return unwrap(res, await this.transfers.create(auth.userId, body, key, client));
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransferResponse> {
    return this.transfers.get(auth.userId, id);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async reverse(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReverseDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferResponse> {
    return unwrap(res, await this.transfers.reverse(auth.userId, id, body, key, client));
  }
}
