import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AccountReportResponse,
  accountReportQuerySchema,
  type CashFlowResponse,
  cashFlowQuerySchema,
  type CategoryReportResponse,
  categoryReportQuerySchema,
  type DashboardResponse,
  dashboardQuerySchema,
  exportQuerySchema,
} from '@takawise/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { SkipEnvelope } from '../../common/envelope/skip-envelope.decorator';
import { Client, type ClientContext } from '../../common/http/client-context';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { ExportService } from './export.service';
import { ReportsService } from './reports.service';

class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}
class CashFlowQueryDto extends createZodDto(cashFlowQuerySchema) {}
class CategoryReportQueryDto extends createZodDto(categoryReportQuerySchema) {}
class AccountReportQueryDto extends createZodDto(accountReportQuerySchema) {}
class ExportQueryDto extends createZodDto(exportQuerySchema) {}

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard/overview')
  dashboard(
    @CurrentUser() auth: AuthContext,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponse> {
    return this.reports.dashboard(auth.userId, query);
  }

  @Get('reports/cash-flow')
  cashFlow(
    @CurrentUser() auth: AuthContext,
    @Query() q: CashFlowQueryDto,
  ): Promise<CashFlowResponse> {
    return this.reports.cashFlow(auth.userId, q.from, q.to, q.currency);
  }

  @Get('reports/categories')
  categories(
    @CurrentUser() auth: AuthContext,
    @Query() q: CategoryReportQueryDto,
  ): Promise<CategoryReportResponse> {
    return this.reports.categories(auth.userId, q);
  }

  @Get('reports/accounts')
  accounts(
    @CurrentUser() auth: AuthContext,
    @Query() q: AccountReportQueryDto,
  ): Promise<AccountReportResponse> {
    return this.reports.accounts(auth.userId, q.from, q.to);
  }

  /** CSV download (not enveloped). Streams batches; cells are formula-safe. */
  @Get('exports/transactions')
  @SkipEnvelope()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiProduces('text/csv')
  async exportTransactions(
    @CurrentUser() auth: AuthContext,
    @Query() query: ExportQueryDto,
    @Client() client: ClientContext,
    @Res() res: Response,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="takawise-transactions-${today}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    const rows = await this.exporter.writeTransactionsCsv(auth.userId, query, res);
    res.end();
    await this.audit.recordSafely(
      { action: 'export.transactions', userId: auth.userId, metadata: { rows } },
      client,
    );
  }
}
