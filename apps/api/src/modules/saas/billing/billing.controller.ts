import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type BillingStatusResponse,
  type CheckoutResponse,
  checkoutRequestSchema,
} from '@takawise/contracts';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Client, type ClientContext } from '../../../common/http/client-context';
import { type AuthContext, CurrentUser, Public } from '../../auth/auth.decorators';
import { SIGNATURE_HEADER } from '../../../domain/saas/signatures';
import { FeatureFlagsService } from '../feature-flags.service';
import { BillingService } from './billing.service';

class CheckoutDto extends createZodDto(checkoutRequestSchema) {}
class ProviderParamDto extends createZodDto(
  z.strictObject({ provider: z.string().regex(/^[a-z0-9-]{2,30}$/) }),
) {}

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('billing')
  @ApiBearerAuth()
  status(@CurrentUser() auth: AuthContext): Promise<BillingStatusResponse> {
    return this.billing.status(auth.userId);
  }

  /** Runtime feature flags so the UI can hide switched-off features (not security). */
  @Get('features')
  @ApiBearerAuth()
  features(): Promise<Record<string, boolean>> {
    return this.flags.all();
  }

  @Post('billing/checkout')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(
    @CurrentUser() auth: AuthContext,
    @Body() body: CheckoutDto,
    @Client() client: ClientContext,
  ): Promise<CheckoutResponse> {
    return this.billing.checkout(auth.userId, body.planCode, client);
  }

  @Post('billing/subscription/cancel')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() auth: AuthContext,
    @Client() client: ClientContext,
  ): Promise<BillingStatusResponse> {
    return this.billing.cancel(auth.userId, client);
  }

  /** Development only (fake provider): completes the caller's own checkout. */
  @Post('billing/fake/complete/:checkoutId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  completeFake(
    @CurrentUser() auth: AuthContext,
    @Param('checkoutId', new ParseUUIDPipe()) checkoutId: string,
  ): Promise<BillingStatusResponse> {
    return this.billing.completeFakeCheckout(auth.userId, checkoutId);
  }

  /**
   * Provider → TakaWise. Public by necessity; trusted only through the HMAC
   * signature over the raw body (verified before parsing) and idempotent per
   * event id.
   */
  @Post('billing/webhooks/:provider')
  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  webhook(
    @Param() params: ProviderParamDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
  ) {
    return this.billing.handleWebhook(params.provider, req.rawBody, signature);
  }
}
