import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { sniffImage } from '../../../domain/ai/media';
import { llmDraftSchema, llmInsightSchema } from '../prompts';
import type { AiGenerateRequest } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { FakeProvider } from './fake.provider';

const schema = z.object({ headline: z.string(), points: z.array(z.string()) });
const request: AiGenerateRequest<z.infer<typeof schema>> = {
  feature: 'MONTHLY_SUMMARY',
  system: 'sys',
  content: [
    { type: 'text', text: 'facts' },
    { type: 'image', mediaType: 'image/png', data: Buffer.from('png') },
  ],
  schema,
  effort: 'medium',
  maxOutputTokens: 1000,
};

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 2,
  cache_read_input_tokens: 3,
};

function providerWith(parse: jest.Mock) {
  const provider = new AnthropicProvider('sk-test-0123456789abcdefghij', 'claude-opus-5-5', 10_000);
  (provider as unknown as { client: unknown }).client = { beta: { messages: { parse } } };
  return provider;
}

describe('AnthropicProvider', () => {
  it('sends a tool-less structured request with fallback and returns validated output', async () => {
    const parse = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      usage,
      parsed_output: { headline: 'h', points: ['p'] },
    });
    const result = await providerWith(parse).generate(request);
    expect(result).toEqual({
      output: { headline: 'h', points: ['p'] },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 15, outputTokens: 5 },
    });
    const params = parse.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      system: 'sys',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    expect(params.tools).toBeUndefined();
    expect(params.messages[0].content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from('png').toString('base64'),
      },
    });
  });

  it.each([
    ['refusal', 'REFUSED'],
    ['max_tokens', 'INVALID_OUTPUT'],
  ])('maps stop_reason %s to %s and keeps the usage', async (stop, code) => {
    const parse = jest
      .fn()
      .mockResolvedValue({ stop_reason: stop, model: 'm', usage, parsed_output: null });
    await expect(providerWith(parse).generate(request)).rejects.toMatchObject({
      code,
      usage: { inputTokens: 15, outputTokens: 5 },
    });
  });

  it('rejects output that does not match the schema', async () => {
    const parse = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      model: 'm',
      usage,
      parsed_output: { headline: 1 },
    });
    await expect(providerWith(parse).generate(request)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it.each([
    [new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()), 'RATE_LIMITED'],
    [new Anthropic.APIConnectionTimeoutError(), 'TIMEOUT'],
    [new Anthropic.APIConnectionError({ message: 'offline' }), 'UNAVAILABLE'],
    [new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers()), 'CONFIG'],
    [new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()), 'UNAVAILABLE'],
    [new Anthropic.AnthropicError('bad json'), 'INVALID_OUTPUT'],
  ])('maps SDK error %p', async (error, code) => {
    const parse = jest.fn().mockRejectedValue(error);
    await expect(providerWith(parse).generate(request)).rejects.toMatchObject({ code });
  });
});

describe('FakeProvider', () => {
  const fake = new FakeProvider();

  it('answers insights with fact references only', async () => {
    const result = await fake.generate({
      ...request,
      content: [{ type: 'text', text: 'income | x | 1\nexpense | y | 2' }],
      schema: llmInsightSchema,
    });
    expect(result.output.headline).toContain('{{income}}');
    expect(result.output.headline).not.toMatch(/\d/);
  });

  it('drafts from the note block', async () => {
    const result = await fake.generate({
      ...request,
      feature: 'TRANSACTION_DRAFT',
      content: [
        {
          type: 'text',
          text: '<untrusted_input>\nA1 | CASH | Wallet | BDT\nC1 | INCOME | Salary\n</untrusted_input>\n<untrusted_input>\nsalary ৫০০০০\n</untrusted_input>',
        },
      ],
      schema: llmDraftSchema,
    });
    expect(result.output).toMatchObject({
      type: 'INCOME',
      amount: '50000',
      accountRef: 'A1',
      categoryRef: 'C1',
    });
  });
});

describe('sniffImage', () => {
  it('recognises JPEG, PNG and WebP by content only', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});
