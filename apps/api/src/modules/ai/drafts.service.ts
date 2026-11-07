import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type DraftResponse,
  EVERYDAY_ACCOUNT_TYPES,
  type Locale,
  transactionDraftRequestSchema,
} from '@takawise/contracts';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { type DraftContext, validateDraft, validateReceipt } from '../../domain/ai/draft';
import { sniffImage } from '../../domain/ai/media';
import { asUntrustedBlock, cleanText, redactIdentifiers } from '../../domain/ai/redact';
import { localDateOf } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import { AiService } from './ai.service';
import {
  draftSystemPrompt,
  llmDraftSchema,
  llmReceiptSchema,
  receiptSystemPrompt,
  referenceLists,
} from './prompts';

type DraftInput = z.output<typeof transactionDraftRequestSchema>;

/** Caps what is sent: a few dozen aliases are plenty to pick from. */
const MAX_ACCOUNTS = 30;
const MAX_CATEGORIES = 80;

type Prepared = {
  ctx: DraftContext;
  lists: string;
  timeZone: string;
};

/**
 * Natural-language and receipt drafts (Phase 9, ADR-024). Returns a draft for
 * the user to review in the normal transaction form; nothing is ever posted
 * here, and receipt images live only in memory for the duration of the call.
 */
@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async fromText(userId: string, input: DraftInput): Promise<DraftResponse> {
    await this.ai.assertAllowed(userId, 'TRANSACTION_DRAFT');
    const prepared = await this.prepare(userId, input.locale);
    // Minimise before sending: identifiers out, invisible characters out.
    const note = cleanText(redactIdentifiers(input.text), 300);

    const { result, model } = await this.ai.invoke(
      userId,
      {
        feature: 'TRANSACTION_DRAFT',
        system: draftSystemPrompt({
          today: prepared.ctx.today,
          timeZone: prepared.timeZone,
          defaultCurrency: prepared.ctx.defaultCurrency,
        }),
        content: [
          {
            type: 'text',
            text: `Reference lists (names typed by the user):\n${asUntrustedBlock(prepared.lists)}\n\nNote:\n${asUntrustedBlock(note)}`,
          },
        ],
        schema: llmDraftSchema,
        effort: 'low',
        maxOutputTokens: 4_000,
      },
      (output) => validateDraft(output, prepared.ctx),
    );
    return {
      source: 'TEXT',
      requiresReview: true,
      draft: result,
      merchant: null,
      lineItems: [],
      model,
    };
  }

  async fromReceipt(
    userId: string,
    file: { buffer: Buffer; size: number } | undefined,
    maxBytes: number,
    locale?: Locale,
  ): Promise<DraftResponse> {
    await this.ai.assertAllowed(userId, 'RECEIPT_OCR');
    if (!file || file.size === 0) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Please check the submitted fields.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'file', message: 'Attach a photo of the receipt' }],
      );
    }
    if (file.size > maxBytes) {
      throw new AppException(
        'PAYLOAD_TOO_LARGE',
        'The image is too large.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const mediaType = sniffImage(file.buffer);
    if (!mediaType) {
      throw new AppException(
        'UNSUPPORTED_MEDIA_TYPE',
        'Upload a JPEG, PNG or WebP image.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const prepared = await this.prepare(userId, locale);

    const { result, model } = await this.ai.invoke(
      userId,
      {
        feature: 'RECEIPT_OCR',
        system: receiptSystemPrompt({
          today: prepared.ctx.today,
          timeZone: prepared.timeZone,
          defaultCurrency: prepared.ctx.defaultCurrency,
        }),
        content: [
          { type: 'image', mediaType, data: file.buffer },
          {
            type: 'text',
            text: `Reference lists (names typed by the user):\n${asUntrustedBlock(prepared.lists)}\n\nExtract the draft from the receipt image above.`,
          },
        ],
        schema: llmReceiptSchema,
        effort: 'low',
        maxOutputTokens: 8_000,
      },
      (output) => validateReceipt(output, prepared.ctx),
    );
    return {
      source: 'RECEIPT',
      requiresReview: true,
      draft: result.draft,
      merchant: result.merchant,
      lineItems: result.lineItems,
      model,
    };
  }

  /** The caller's own active accounts and categories, as short aliases only. */
  private async prepare(userId: string, requested?: Locale): Promise<Prepared> {
    const [profile, accounts, categories] = await Promise.all([
      this.prisma.userProfile.findUnique({
        where: { userId },
        select: { timezone: true, defaultCurrency: true, locale: true },
      }),
      this.prisma.financialAccount.findMany({
        where: { userId, status: 'ACTIVE', type: { in: [...EVERYDAY_ACCOUNT_TYPES] } },
        orderBy: { createdAt: 'asc' },
        take: MAX_ACCOUNTS,
        select: { id: true, name: true, type: true, currency: true },
      }),
      this.prisma.category.findMany({
        where: { OR: [{ userId: null }, { userId }], status: 'ACTIVE' },
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { nameEn: 'asc' }],
        take: MAX_CATEGORIES,
        select: { id: true, type: true, nameEn: true, nameBn: true },
      }),
    ]);
    const timeZone = profile?.timezone ?? 'Asia/Dhaka';
    const locale = requested ?? (profile?.locale === 'BN' ? 'bn' : 'en');
    const name = (s: string) => cleanText(redactIdentifiers(s), 60);
    const accountRefs = accounts.map((a, i) => ({ ...a, ref: `A${i + 1}`, name: name(a.name) }));
    const categoryRefs = categories.map((c, i) => ({
      ref: `C${i + 1}`,
      id: c.id,
      type: c.type,
      name: name(locale === 'bn' ? c.nameBn : c.nameEn),
    }));
    return {
      timeZone,
      lists: referenceLists({ accounts: accountRefs, categories: categoryRefs }),
      ctx: {
        accounts: accountRefs.map(({ ref, id, currency }) => ({ ref, id, currency })),
        categories: categoryRefs.map(({ ref, id, type }) => ({ ref, id, type })),
        today: localDateOf(new Date(), timeZone),
        defaultCurrency: profile?.defaultCurrency ?? 'BDT',
      },
    };
  }
}
