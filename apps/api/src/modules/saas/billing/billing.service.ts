import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { BillingStatusResponse, CheckoutResponse, PaymentEvent } from '@takawise/contracts';
import { AppException } from '../../../common/errors/app.exception';
import type { ClientContext } from '../../../common/http/client-context';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env';
import { addMonthsUtc, FREE_PLAN, LIVE_STATUSES } from '../../../domain/saas/entitlements';
import { signPayload } from '../../../domain/saas/signatures';
import { money } from '../../../domain/money/money';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/audit.service';
import { EntitlementsService, toPlanResponse } from '../entitlements.service';
import { FeatureFlagsService } from '../feature-flags.service';
import { PaymentProvider } from './payment-provider';

type Tx = Prisma.TransactionClient;

/** No client request: the provider is the actor. */
const SYSTEM_CLIENT: ClientContext = { requestId: 'webhook', ip: null, userAgent: null };

const notFound = () =>
  new AppException('NOT_FOUND', 'The requested resource was not found.', HttpStatus.NOT_FOUND);

/**
 * Checkout and subscription lifecycle (ADR-025). The webhook is the only way
 * a purchase becomes a subscription; checkout only records intent.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: PaymentProvider,
    private readonly entitlements: EntitlementsService,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
  ) {}

  async status(userId: string): Promise<BillingStatusResponse> {
    const [effective, accounts, plans, checkoutOn] = await Promise.all([
      this.entitlements.effective(userId),
      this.entitlements.countAccounts(userId),
      this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.flags.isOn('billing.checkout'),
    ]);
    return {
      ...effective,
      usage: { accounts },
      plans: plans.map(toPlanResponse).filter((p) => p.code === FREE_PLAN || p.active),
      provider: this.provider.name,
      checkoutEnabled: this.provider.enabled && checkoutOn,
    };
  }

  async checkout(
    userId: string,
    planCode: string,
    client: ClientContext,
  ): Promise<CheckoutResponse> {
    await this.flags.assertOn('billing.checkout');
    if (!this.provider.enabled) {
      throw new AppException(
        'FEATURE_DISABLED',
        'Online payment is not available yet.',
        HttpStatus.FORBIDDEN,
      );
    }
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (
      !plan ||
      !plan.active ||
      plan.code === FREE_PLAN ||
      !money(plan.priceAmount).greaterThan(0)
    ) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'planCode', message: 'This plan cannot be bought right now' }],
      );
    }
    const expiresAt = new Date(Date.now() + this.config.CHECKOUT_TTL_MINUTES * 60_000);
    const checkout = await this.prisma.billingCheckout.create({
      data: {
        userId,
        planCode: plan.code,
        provider: this.provider.name,
        amount: plan.priceAmount,
        currency: plan.currency,
        expiresAt,
      },
    });
    const { url } = await this.provider.createCheckout({
      checkoutId: checkout.id,
      planCode: plan.code,
      amount: money(plan.priceAmount).toFixed(2),
      currency: plan.currency,
    });
    await this.audit.record(
      {
        action: 'billing.checkout.created',
        userId,
        entityType: 'billing_checkout',
        entityId: checkout.id,
        metadata: { planCode: plan.code },
      },
      client,
    );
    return { checkoutId: checkout.id, url, expiresAt: expiresAt.toISOString() };
  }

  /** Access continues until the end of the paid period; nothing renews after it. */
  async cancel(userId: string, client: ClientContext): Promise<BillingStatusResponse> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: [...LIVE_STATUSES] } },
    });
    if (!sub) throw notFound();
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    });
    await this.audit.record(
      {
        action: 'billing.subscription.cancel_requested',
        userId,
        entityType: 'subscription',
        entityId: sub.id,
      },
      client,
    );
    return this.status(userId);
  }

  // ─────────────────────────────── Webhooks ───────────────────────────────

  /**
   * Verifies, records (once) and applies a provider event. Duplicate deliveries
   * hit the unique (provider, event_id) key and change nothing.
   */
  async handleWebhook(
    providerName: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean; outcome: string }> {
    if (providerName !== this.provider.name || !this.provider.enabled) throw notFound();
    if (!rawBody) throw this.invalid('missing body');
    const check = this.provider.verify(rawBody, signature);
    if (check !== 'ok') {
      this.logger.warn({ provider: providerName, check }, 'Rejected webhook signature');
      throw new AppException(
        'INVALID_SIGNATURE',
        'Invalid webhook signature.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const event = this.provider.parse(rawBody);
    if (!event) throw this.invalid('unreadable event');

    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const result = await this.apply(tx, event);
        await tx.paymentEvent.create({
          data: {
            provider: providerName,
            eventId: event.id,
            type: event.type,
            payloadHash,
            outcome: result,
          },
        });
        return result;
      });
      return { received: true, duplicate: false, outcome };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true, outcome: 'duplicate' };
      }
      throw error;
    }
  }

  private async apply(tx: Tx, event: PaymentEvent): Promise<string> {
    const now = new Date();
    switch (event.type) {
      case 'checkout.completed': {
        const checkout = event.data.checkoutId
          ? await tx.billingCheckout.findUnique({
              where: { id: event.data.checkoutId },
              include: { plan: true },
            })
          : null;
        if (!checkout || checkout.provider !== this.provider.name) return 'unknown_checkout';
        if (checkout.status === 'COMPLETED') return 'already_completed';
        // A paid checkout is honoured even if our TTL passed: the money was taken.
        await this.endLive(tx, checkout.userId, now);
        const sub = await tx.subscription.create({
          data: {
            userId: checkout.userId,
            planCode: checkout.planCode,
            status: 'ACTIVE',
            provider: this.provider.name,
            providerSubscriptionId: event.data.subscriptionId ?? `checkout_${checkout.id}`,
            currentPeriodEnd: event.data.currentPeriodEnd
              ? new Date(event.data.currentPeriodEnd)
              : addMonthsUtc(now, checkout.plan.interval === 'YEAR' ? 12 : 1),
          },
        });
        await tx.billingCheckout.update({
          where: { id: checkout.id },
          data: { status: 'COMPLETED', completedAt: now },
        });
        await this.auditSystem(tx, 'billing.subscription.activated', checkout.userId, sub.id, {
          planCode: checkout.planCode,
        });
        return 'activated';
      }
      case 'subscription.renewed':
      case 'subscription.canceled':
      case 'payment.failed': {
        const sub = event.data.subscriptionId
          ? await tx.subscription.findUnique({
              where: {
                provider_providerSubscriptionId: {
                  provider: this.provider.name,
                  providerSubscriptionId: event.data.subscriptionId,
                },
              },
              include: { plan: true },
            })
          : null;
        if (!sub) return 'unknown_subscription';
        if (!(LIVE_STATUSES as readonly string[]).includes(sub.status)) return 'not_live';
        if (event.type === 'subscription.renewed') {
          const from = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: 'ACTIVE',
              currentPeriodEnd: event.data.currentPeriodEnd
                ? new Date(event.data.currentPeriodEnd)
                : addMonthsUtc(from, sub.plan.interval === 'YEAR' ? 12 : 1),
            },
          });
          await this.auditSystem(tx, 'billing.subscription.renewed', sub.userId, sub.id);
          return 'renewed';
        }
        if (event.type === 'subscription.canceled') {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: 'CANCELED', endedAt: now },
          });
          await this.auditSystem(tx, 'billing.subscription.canceled', sub.userId, sub.id);
          return 'canceled';
        }
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        await this.auditSystem(tx, 'billing.subscription.past_due', sub.userId, sub.id);
        return 'past_due';
      }
      default:
        return 'ignored';
    }
  }

  /** Ends the user's live subscription (replaced by a new one). */
  async endLive(tx: Tx, userId: string, now = new Date()): Promise<void> {
    await tx.subscription.updateMany({
      where: { userId, status: { in: [...LIVE_STATUSES] } },
      data: { status: 'CANCELED', endedAt: now },
    });
  }

  private auditSystem(
    tx: Tx,
    action:
      | 'billing.subscription.activated'
      | 'billing.subscription.renewed'
      | 'billing.subscription.canceled'
      | 'billing.subscription.past_due',
    userId: string,
    subscriptionId: string,
    metadata?: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        action,
        userId,
        actorId: null,
        entityType: 'subscription',
        entityId: subscriptionId,
        metadata,
      },
      SYSTEM_CLIENT,
      tx,
    );
  }

  private invalid(reason: string) {
    return new AppException(
      'BAD_REQUEST',
      'The webhook could not be processed.',
      HttpStatus.BAD_REQUEST,
      [{ message: reason }],
    );
  }

  // ─────────────────────────── Development only ───────────────────────────

  /**
   * Stand-in for the provider's hosted page (fake provider, never production):
   * emits a correctly signed `checkout.completed` webhook through the real
   * webhook path for the caller's own pending checkout.
   */
  async completeFakeCheckout(userId: string, checkoutId: string): Promise<BillingStatusResponse> {
    if (this.provider.name !== 'fake' || this.config.isProduction) throw notFound();
    const checkout = await this.prisma.billingCheckout.findFirst({
      where: { id: checkoutId, userId },
    });
    if (!checkout) throw notFound();
    const body = Buffer.from(
      JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: 'checkout.completed',
        data: { checkoutId: checkout.id, subscriptionId: `fake_sub_${randomUUID()}` },
      }),
    );
    const header = signPayload(
      this.config.PAYMENT_PROVIDER_SECRET!,
      body,
      Math.floor(Date.now() / 1000),
    );
    await this.handleWebhook('fake', body, header);
    return this.status(userId);
  }
}
