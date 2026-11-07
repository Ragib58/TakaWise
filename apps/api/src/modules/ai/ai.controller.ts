import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  aiConsentScopeSchema,
  type AiStatusResponse,
  type DeleteAiDataResponse,
  type DraftResponse,
  grantAiConsentRequestSchema,
  type InsightResponse,
  insightRequestSchema,
  localeSchema,
  transactionDraftRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { AiService } from './ai.service';
import { DraftsService } from './drafts.service';
import { InsightsService } from './insights.service';

class GrantConsentDto extends createZodDto(grantAiConsentRequestSchema) {}
class InsightRequestDto extends createZodDto(insightRequestSchema) {}
class DraftRequestDto extends createZodDto(transactionDraftRequestSchema) {}
class ScopeParamDto extends createZodDto(z.strictObject({ scope: aiConsentScopeSchema })) {}
class ReceiptQueryDto extends createZodDto(z.strictObject({ locale: localeSchema.optional() })) {}

/** What multer hands us (memory storage: the image never touches disk). */
type UploadedImage = { buffer: Buffer; size: number };

/** Hard ceiling for multer; the configured OCR_MAX_BYTES (≤ this) is checked in the service. */
const MULTER_MAX_BYTES = 5_000_000;
/** Provider calls are slow and cost money: a tight per-route limit on top of usage limits. */
const AI_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly insights: InsightsService,
    private readonly drafts: DraftsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('status')
  status(@CurrentUser() auth: AuthContext): Promise<AiStatusResponse> {
    return this.ai.status(auth.userId);
  }

  @Put('consents/:scope')
  @HttpCode(HttpStatus.OK)
  async grant(
    @CurrentUser() auth: AuthContext,
    @Param() params: ScopeParamDto,
    @Body() _body: GrantConsentDto,
    @Client() client: ClientContext,
  ): Promise<AiStatusResponse> {
    await this.ai.grantConsent(auth.userId, params.scope, client);
    return this.ai.status(auth.userId);
  }

  @Delete('consents/:scope')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentUser() auth: AuthContext,
    @Param() params: ScopeParamDto,
    @Client() client: ClientContext,
  ): Promise<AiStatusResponse> {
    await this.ai.revokeConsent(auth.userId, params.scope, client);
    return this.ai.status(auth.userId);
  }

  @Delete('data')
  @HttpCode(HttpStatus.OK)
  deleteData(
    @CurrentUser() auth: AuthContext,
    @Client() client: ClientContext,
  ): Promise<DeleteAiDataResponse> {
    return this.ai.deleteData(auth.userId, client);
  }

  @Post('insights')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  insight(
    @CurrentUser() auth: AuthContext,
    @Body() body: InsightRequestDto,
  ): Promise<InsightResponse> {
    return this.insights.generate(auth.userId, body);
  }

  @Post('drafts/transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  draft(@CurrentUser() auth: AuthContext, @Body() body: DraftRequestDto): Promise<DraftResponse> {
    return this.drafts.fromText(auth.userId, body);
  }

  @Post('receipts/extract')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTER_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  receipt(
    @CurrentUser() auth: AuthContext,
    @UploadedFile() file: UploadedImage | undefined,
    @Query() query: ReceiptQueryDto,
  ): Promise<DraftResponse> {
    return this.drafts.fromReceipt(auth.userId, file, this.config.OCR_MAX_BYTES, query.locale);
  }
}
