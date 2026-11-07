import { toAsciiDigits } from '../../../domain/ai/redact';
import {
  type AiGenerateRequest,
  type AiGenerateResult,
  AiProvider,
  AiProviderError,
} from './ai-provider';

/**
 * Deterministic offline provider for development, CI and E2E (rejected in
 * production by config validation). It never leaves the process and returns
 * outputs that satisfy the same schemas as a real model, built from the prompt,
 * so the whole pipeline — limits, validation, UI — can run without a key.
 */
export class FakeProvider extends AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';

  generate<T>(request: AiGenerateRequest<T>): Promise<AiGenerateResult<T>> {
    const text = request.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    const output = this.answer(request, text);
    const checked = request.schema.safeParse(output);
    if (!checked.success) {
      return Promise.reject(new AiProviderError('INVALID_OUTPUT', 'fake output mismatch'));
    }
    return Promise.resolve({
      output: checked.data,
      model: this.model,
      usage: { inputTokens: (request.system.length + text.length) >> 2, outputTokens: 60 },
    });
  }

  private answer(request: AiGenerateRequest<unknown>, text: string): unknown {
    switch (request.feature) {
      case 'MONTHLY_SUMMARY':
      case 'UNUSUAL_SPENDING':
      case 'SAVINGS_SUGGESTIONS':
        return this.insight(request.feature, text);
      case 'TRANSACTION_DRAFT':
        return this.draft(text);
      case 'RECEIPT_OCR':
        return {
          ...this.blankDraft(),
          type: 'EXPENSE',
          amount: '250.00',
          categoryRef: this.firstRef(text, 'C', 'EXPENSE'),
          accountRef: this.firstRef(text, 'A'),
          merchant: 'Sample Store',
          description: 'Groceries',
          confidence: 'MEDIUM',
          lineItems: [
            { description: 'Rice', amount: '180.00' },
            { description: 'Lentils', amount: '70.00' },
          ],
        };
    }
  }

  private insight(feature: string, text: string) {
    const ids = [...text.matchAll(/^([a-z][a-z0-9_]*) \| /gm)].map((m) => m[1]!);
    const has = (id: string) => ids.includes(id);
    if (feature === 'UNUSUAL_SPENDING' && has('u1_name')) {
      return {
        headline: 'Spending on {{u1_name}} was higher than usual this month.',
        points: [
          'You spent {{u1_amount}} there, compared with a usual {{u1_usual}}.',
          'A one-off purchase or a festival could explain it; check the transactions in that category.',
        ],
      };
    }
    if (feature === 'SAVINGS_SUGGESTIONS') {
      return {
        headline: has('savings_rate')
          ? 'You kept {{savings_rate}} of your income this month.'
          : 'You spent {{expense}} this month.',
        points: [
          has('cat1_name')
            ? 'Your largest spending was {{cat1_name}}; a monthly limit there could help.'
            : 'Setting a monthly limit for your largest category could help.',
          'Reviewing small, frequent expenses is a simple place to start.',
        ],
      };
    }
    return {
      headline: 'This month you received {{income}} and spent {{expense}}.',
      points: [
        has('cat1_name')
          ? 'Most of your spending went to {{cat1_name}}.'
          : 'Your spending was spread across categories.',
        'These figures come only from what you recorded.',
      ],
    };
  }

  private draft(text: string) {
    const open = text.lastIndexOf('<untrusted_input>\n');
    const close = text.lastIndexOf('\n</untrusted_input>');
    const note =
      open >= 0 && close > open ? text.slice(open + '<untrusted_input>\n'.length, close) : '';
    const amount = /(\d+(?:\.\d+)?)/.exec(toAsciiDigits(note).replace(/,/g, ''))?.[1] ?? '';
    const income = /salary|income|received|got paid|বেতন|আয়/i.test(note);
    const type = amount ? (income ? 'INCOME' : 'EXPENSE') : 'UNKNOWN';
    return {
      ...this.blankDraft(),
      type,
      amount,
      accountRef: this.firstRef(text, 'A'),
      categoryRef: type === 'UNKNOWN' ? '' : this.firstRef(text, 'C', type),
      description: note
        .replace(/\d[\d.,]*/g, '')
        .trim()
        .slice(0, 40),
      confidence: amount ? 'MEDIUM' : 'LOW',
      instructionsDetected: /ignore (all |any )?(previous|prior)/i.test(note),
    };
  }

  private blankDraft() {
    return {
      type: 'UNKNOWN',
      amount: '',
      currency: '',
      date: '',
      accountRef: '',
      categoryRef: '',
      description: '',
      confidence: 'LOW',
      multipleTransactions: false,
      instructionsDetected: false,
    };
  }

  private firstRef(text: string, prefix: 'A' | 'C', type?: string): string {
    const pattern = new RegExp(`^(${prefix}\\d+) \\| ${type ?? '[A-Z_]+'} \\|`, 'm');
    return pattern.exec(text)?.[1] ?? '';
  }
}
