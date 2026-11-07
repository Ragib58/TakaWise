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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  createInvestmentRequestSchema,
  createLoanPaymentRequestSchema,
  createLoanRequestSchema,
  createNetWorthItemRequestSchema,
  createValuationRequestSchema,
  type InvestmentDetailResponse,
  type InvestmentResponse,
  listWealthQuerySchema,
  type LoanDetailResponse,
  type LoanResponse,
  type NetWorthHistoryResponse,
  netWorthHistoryQuerySchema,
  type NetWorthItemResponse,
  netWorthQuerySchema,
  type NetWorthResponse,
  updateInvestmentRequestSchema,
  updateLoanRequestSchema,
  updateNetWorthItemRequestSchema,
} from '@takawise/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import {
  IDEMPOTENT_REPLAYED_HEADER,
  IdempotencyKey,
} from '../idempotency/idempotency-key.decorator';
import { InvestmentsService } from './investments.service';
import { LoansService } from './loans.service';
import { NetWorthService } from './net-worth.service';

class ListWealthQueryDto extends createZodDto(listWealthQuerySchema) {}
class CreateInvestmentDto extends createZodDto(createInvestmentRequestSchema) {}
class UpdateInvestmentDto extends createZodDto(updateInvestmentRequestSchema) {}
class CreateValuationDto extends createZodDto(createValuationRequestSchema) {}
class CreateLoanDto extends createZodDto(createLoanRequestSchema) {}
class UpdateLoanDto extends createZodDto(updateLoanRequestSchema) {}
class CreateLoanPaymentDto extends createZodDto(createLoanPaymentRequestSchema) {}
class NetWorthQueryDto extends createZodDto(netWorthQuerySchema) {}
class NetWorthHistoryQueryDto extends createZodDto(netWorthHistoryQuerySchema) {}
class CreateNetWorthItemDto extends createZodDto(createNetWorthItemRequestSchema) {}
class UpdateNetWorthItemDto extends createZodDto(updateNetWorthItemRequestSchema) {}

const IDEMPOTENCY_HEADER_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated UUID',
};
const uuid = (name: string) => Param(name, ParseUUIDPipe);

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListWealthQueryDto,
  ): Promise<InvestmentResponse[]> {
    return this.investments.list(auth.userId, query.status);
  }

  @Post()
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateInvestmentDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvestmentDetailResponse> {
    const result = await this.investments.create(auth.userId, body, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get(':id')
  get(@CurrentUser() auth: AuthContext, @uuid('id') id: string): Promise<InvestmentDetailResponse> {
    return this.investments.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: UpdateInvestmentDto,
    @Client() client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    return this.investments.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    return this.investments.setArchived(auth.userId, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    return this.investments.setArchived(auth.userId, id, false, client);
  }

  @Post(':id/valuations')
  addValuation(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: CreateValuationDto,
    @Client() client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    return this.investments.addValuation(auth.userId, id, body, client);
  }

  @Delete(':id/valuations/:valuationId')
  deleteValuation(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @uuid('valuationId') valuationId: string,
    @Client() client: ClientContext,
  ): Promise<InvestmentDetailResponse> {
    return this.investments.deleteValuation(auth.userId, id, valuationId, client);
  }
}

@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListWealthQueryDto,
  ): Promise<LoanResponse[]> {
    return this.loans.list(auth.userId, query.status);
  }

  @Post()
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateLoanDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoanDetailResponse> {
    const result = await this.loans.create(auth.userId, body, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Get(':id')
  get(@CurrentUser() auth: AuthContext, @uuid('id') id: string): Promise<LoanDetailResponse> {
    return this.loans.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: UpdateLoanDto,
    @Client() client: ClientContext,
  ): Promise<LoanDetailResponse> {
    return this.loans.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<LoanDetailResponse> {
    return this.loans.setArchived(auth.userId, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<LoanDetailResponse> {
    return this.loans.setArchived(auth.userId, id, false, client);
  }

  @Post(':id/payments')
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async addPayment(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: CreateLoanPaymentDto,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoanDetailResponse> {
    const result = await this.loans.addPayment(auth.userId, id, body, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Post(':id/payments/:paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER_DOC)
  async reversePayment(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @uuid('paymentId') paymentId: string,
    @IdempotencyKey() key: string,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoanDetailResponse> {
    const result = await this.loans.reversePayment(auth.userId, id, paymentId, key, client);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }
}

@ApiTags('net-worth')
@ApiBearerAuth()
@Controller('net-worth')
export class NetWorthController {
  constructor(private readonly netWorth: NetWorthService) {}

  @Get()
  get(
    @CurrentUser() auth: AuthContext,
    @Query() query: NetWorthQueryDto,
  ): Promise<NetWorthResponse> {
    return this.netWorth.get(auth.userId, query.asOf);
  }

  @Get('history')
  history(
    @CurrentUser() auth: AuthContext,
    @Query() query: NetWorthHistoryQueryDto,
  ): Promise<NetWorthHistoryResponse> {
    return this.netWorth.history(auth.userId, query.months);
  }

  @Get('items')
  listItems(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListWealthQueryDto,
  ): Promise<NetWorthItemResponse[]> {
    return this.netWorth.listItems(auth.userId, query.status);
  }

  @Post('items')
  createItem(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateNetWorthItemDto,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.createItem(auth.userId, body, client);
  }

  @Get('items/:id')
  getItem(@CurrentUser() auth: AuthContext, @uuid('id') id: string): Promise<NetWorthItemResponse> {
    return this.netWorth.getItem(auth.userId, id);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: UpdateNetWorthItemDto,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.updateItem(auth.userId, id, body, client);
  }

  @Post('items/:id/archive')
  @HttpCode(HttpStatus.OK)
  archiveItem(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.setItemArchived(auth.userId, id, true, client);
  }

  @Post('items/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreItem(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.setItemArchived(auth.userId, id, false, client);
  }

  @Post('items/:id/valuations')
  addItemValuation(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @Body() body: CreateValuationDto,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.addItemValuation(auth.userId, id, body, client);
  }

  @Delete('items/:id/valuations/:valuationId')
  deleteItemValuation(
    @CurrentUser() auth: AuthContext,
    @uuid('id') id: string,
    @uuid('valuationId') valuationId: string,
    @Client() client: ClientContext,
  ): Promise<NetWorthItemResponse> {
    return this.netWorth.deleteItemValuation(auth.userId, id, valuationId, client);
  }
}
