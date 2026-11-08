import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_CONSENT_SCOPES,
  AI_POLICY_VERSION,
  type AiConsentScope,
  type AiFeature,
  type AiStatusResponse,
  CONSENT_FOR_FEATURE,
  type DeleteAiDataResponse,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { ClientContext } from '../../common/http/client-context';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../saas/entitlements.service';
import { FeatureFlagsService } from '../saas/feature-flags.service';
import {
  type AiGenerateRequest,
  AiProvider,
  AiProviderError,
  type AiUsage,
} from './providers/ai-provider';

const DAY_MS = 86_400_000;

const ENTITLEMENT_FOR_FEATURE = {
  MONTHLY_SUMMARY: 'aiInsights',
  UNUSUAL_SPENDING: 'aiInsights',
  SAVINGS_SUGGESTIONS: 'aiInsights',
  TRANSACTION_DRAFT: 'aiDrafts',
  RECEIPT_OCR: 'receiptOcr',
} as const satisfies Record<AiFeature, 'aiInsights' | 'aiDrafts' | 'receiptOcr'>;

const startOfUtcMonth = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Thrown by a feature's validator when the model's answer breaks the rules. */
export class AiAnswerRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'AiAnswerRejected';
  }
}

/**
 * Gatekeeper for every provider call (Phase 9, ADR-024): feature flag →
 * consent → per-user and global limits → call → validate → usage row. Only
 * metadata (feature, tokens, status) is stored; never prompts or answers.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: AiProvider,
    private readonly audit: AuditService,
    private readonly flags: FeatureFlagsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  get enabled(): boolean {
    return this.config.AI_ENABLED && this.config.AI_PROVIDER !== 'none';
  }

  enabledFeatures(): AiFeature[] {
    return this.enabled ? [...this.config.AI_FEATURES] : [];
  }

  // ───────────────────────────── Status & consent ─────────────────────────────

  async status(userId: string): Promise<AiStatusResponse> {
    const [rows, usage] = await Promise.all([
      this.prisma.aiConsent.findMany({ where: { userId } }),
      this.usage(userId),
    ]);
    return {
      enabled: this.enabled,
      provider: this.enabled ? this.provider.name : null,
      model: this.enabled ? this.provider.model : null,
      policyVersion: AI_POLICY_VERSION,
      features: this.enabledFeatures(),
      consents: AI_CONSENT_SCOPES.map((scope) => {
        const row = rows.find((r) => r.scope === scope);
        const granted = !!row && !row.revokedAt && row.policyVersion === AI_POLICY_VERSION;
        return {
          scope,
          granted,
          grantedAt: granted ? row.grantedAt.toISOString() : null,
          policyVersion: row && !row.revokedAt ? row.policyVersion : null,
        };
      }),
      usage: {
        requestsToday: usage.requestsToday,
        dailyRequestLimit: this.config.AI_USER_DAILY_REQUESTS,
        tokensThisMonth: usage.tokensThisMonth,
        monthlyTokenLimit: this.config.AI_USER_MONTHLY_TOKENS,
      },
      receiptMaxBytes: this.config.OCR_MAX_BYTES,
    };
  }

  async grantConsent(userId: string, scope: AiConsentScope, client: ClientContext): Promise<void> {
    if (!this.enabled) throw this.disabled();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.aiConsent.upsert({
        where: { userId_scope: { userId, scope } },
        create: { userId, scope, policyVersion: AI_POLICY_VERSION, grantedAt: now },
        update: { policyVersion: AI_POLICY_VERSION, grantedAt: now, revokedAt: null },
      });
      await this.audit.record(
        {
          action: 'ai.consent.granted',
          userId,
          entityType: 'ai_consent',
          metadata: { scope, policyVersion: AI_POLICY_VERSION },
        },
        client,
        tx,
      );
    });
  }

  /** Withdrawal is always possible, even while AI is switched off. */
  async revokeConsent(userId: string, scope: AiConsentScope, client: ClientContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.aiConsent.updateMany({
        where: { userId, scope, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Insights were produced under this consent: withdrawing it removes them.
      if (scope === 'INSIGHTS') await tx.aiInsight.deleteMany({ where: { userId } });
      if (count > 0) {
        await this.audit.record(
          { action: 'ai.consent.revoked', userId, entityType: 'ai_consent', metadata: { scope } },
          client,
          tx,
        );
      }
    });
  }

  /** "Delete my AI data": withdraws every consent and deletes stored insights. */
  async deleteData(userId: string, client: ClientContext): Promise<DeleteAiDataResponse> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.aiConsent.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const deleted = await tx.aiInsight.deleteMany({ where: { userId } });
      await this.audit.record(
        {
          action: 'ai.data.deleted',
          userId,
          entityType: 'ai_data',
          metadata: { consentsRevoked: revoked.count, insightsDeleted: deleted.count },
        },
        client,
        tx,
      );
      return { consentsRevoked: revoked.count, insightsDeleted: deleted.count };
    });
  }

  // ───────────────────────────── Gate & call ─────────────────────────────

  /** Feature flag and consent. Cheap; call before computing anything. */
  async assertAllowed(userId: string, feature: AiFeature): Promise<void> {
    if (!this.enabled || !this.config.AI_FEATURES.includes(feature)) throw this.disabled();
    const scope = CONSENT_FOR_FEATURE[feature];
    const consent = await this.prisma.aiConsent.findUnique({
      where: { userId_scope: { userId, scope } },
    });
    if (!consent || consent.revokedAt || consent.policyVersion !== AI_POLICY_VERSION) {
      throw new AppException(
        'AI_CONSENT_REQUIRED',
        'Please review and accept the AI data notice first.',
        HttpStatus.FORBIDDEN,
        [{ field: 'scope', message: scope }],
      );
    }
    // Phase 10: admin kill switch, then the plan (ADR-025).
    await this.flags.assertOn('ai.assistant');
    await this.entitlements.assertFeature(userId, ENTITLEMENT_FOR_FEATURE[feature]);
  }

  /**
   * Calls the provider under the limits, then runs the feature's validator on
   * the answer. Every attempt leaves exactly one usage row.
   */
  async invoke<T, R>(
    userId: string,
    request: AiGenerateRequest<T>,
    validate: (output: T, model: string) => R,
  ): Promise<{ result: R; model: string }> {
    await this.assertWithinLimits(userId);
    const started = Date.now();
    let usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let model = this.provider.model;
    try {
      const answer = await this.provider.generate(request);
      usage = answer.usage;
      model = answer.model;
      const result = validate(answer.output, answer.model);
      await this.log(userId, request, 'SUCCEEDED', model, usage, started, null);
      return { result, model };
    } catch (error) {
      if (error instanceof AiAnswerRejected) {
        await this.log(userId, request, 'REJECTED', model, usage, started, 'VALIDATION');
        this.logger.warn({ feature: request.feature, reason: error.reason }, 'AI answer rejected');
        throw this.invalidOutput();
      }
      if (error instanceof AiProviderError) {
        const rejected = error.code === 'REFUSED' || error.code === 'INVALID_OUTPUT';
        await this.log(
          userId,
          request,
          rejected ? 'REJECTED' : 'FAILED',
          model,
          error.usage,
          started,
          error.code,
        );
        this.logger.warn({ feature: request.feature, code: error.code }, 'AI provider call failed');
        throw rejected ? this.invalidOutput() : this.unavailable();
      }
      await this.log(userId, request, 'FAILED', model, usage, started, 'INTERNAL');
      throw error;
    }
  }

  private async assertWithinLimits(userId: string): Promise<void> {
    const usage = await this.usage(userId);
    if (usage.requestsToday >= this.config.AI_USER_DAILY_REQUESTS) {
      throw this.limit('daily request limit reached');
    }
    if (usage.tokensThisMonth >= this.config.AI_USER_MONTHLY_TOKENS) {
      throw this.limit('monthly usage limit reached');
    }
    const global = await this.prisma.aiRequest.aggregate({
      where: { createdAt: { gte: startOfUtcDay(new Date()) } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const globalTokens = (global._sum.inputTokens ?? 0) + (global._sum.outputTokens ?? 0);
    if (globalTokens >= this.config.AI_GLOBAL_DAILY_TOKENS) {
      this.logger.error({ globalTokens }, 'AI global daily token budget exhausted');
      throw this.unavailable();
    }
  }

  private async usage(userId: string): Promise<{ requestsToday: number; tokensThisMonth: number }> {
    const now = new Date();
    const [requestsToday, month] = await Promise.all([
      this.prisma.aiRequest.count({
        where: { userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      }),
      this.prisma.aiRequest.aggregate({
        where: { userId, createdAt: { gte: startOfUtcMonth(now) } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);
    return {
      requestsToday,
      tokensThisMonth: (month._sum.inputTokens ?? 0) + (month._sum.outputTokens ?? 0),
    };
  }

  private log(
    userId: string,
    request: AiGenerateRequest<unknown>,
    status: 'SUCCEEDED' | 'REJECTED' | 'FAILED',
    model: string,
    usage: AiUsage,
    started: number,
    errorCode: string | null,
  ) {
    return this.prisma.aiRequest.create({
      data: {
        userId,
        feature: request.feature,
        status,
        provider: this.provider.name,
        model: model.slice(0, 64),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        errorCode,
        durationMs: Date.now() - started,
      },
    });
  }

  private disabled() {
    return new AppException(
      'FEATURE_DISABLED',
      'This feature is not available.',
      HttpStatus.FORBIDDEN,
    );
  }

  private limit(reason: string) {
    return new AppException(
      'AI_LIMIT_REACHED',
      'You have reached your AI usage limit. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ message: reason }],
    );
  }

  private unavailable() {
    return new AppException(
      'AI_UNAVAILABLE',
      'The AI assistant is temporarily unavailable. Nothing was saved.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private invalidOutput() {
    return new AppException(
      'AI_OUTPUT_INVALID',
      'The AI assistant could not produce a reliable answer. Nothing was saved.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
