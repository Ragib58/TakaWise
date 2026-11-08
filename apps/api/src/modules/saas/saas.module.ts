import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { PlatformRolesGuard } from './admin/platform-roles.guard';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import {
  FakePaymentProvider,
  NoPaymentProvider,
  PaymentProvider,
} from './billing/payment-provider';
import { EntitlementsService } from './entitlements.service';
import { FamilyController } from './family/family.controller';
import { FamilyService } from './family/family.service';
import { FeatureFlagsService } from './feature-flags.service';
import { SupportController } from './support/support.controller';
import { SupportService } from './support/support.service';

export function createPaymentProvider(config: AppConfig): PaymentProvider {
  return config.PAYMENT_PROVIDER === 'fake'
    ? new FakePaymentProvider(config.PAYMENT_PROVIDER_SECRET!, config.APP_BASE_URL)
    : new NoPaymentProvider();
}

/**
 * Phase 10: plans and entitlements, billing, family workspaces, support and
 * the admin route group (ADR-025/026/027). Global so feature modules (accounts,
 * AI) can enforce entitlements and runtime flags.
 */
@Global()
@Module({
  controllers: [BillingController, FamilyController, SupportController, AdminController],
  providers: [
    { provide: PaymentProvider, inject: [APP_CONFIG], useFactory: createPaymentProvider },
    EntitlementsService,
    FeatureFlagsService,
    BillingService,
    FamilyService,
    SupportService,
    AdminService,
    PlatformRolesGuard,
  ],
  exports: [EntitlementsService, FeatureFlagsService],
})
export class SaasModule {}
