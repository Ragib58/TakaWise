import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Logger } from '@nestjs/common';
import {
  type AiContentPart,
  type AiGenerateRequest,
  type AiGenerateResult,
  AiProvider,
  AiProviderError,
  type AiUsage,
} from './ai-provider';

/** Server-side fallback beta: a policy decline is retried on the server's default fallback model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam;

const toBlock = (part: AiContentPart): BetaContent =>
  part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image',
        source: { type: 'base64', media_type: part.mediaType, data: part.data.toString('base64') },
      };

const usageOf = (usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}): AiUsage => ({
  inputTokens:
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0),
  outputTokens: usage.output_tokens,
});

/**
 * Claude via the official Anthropic SDK. Structured outputs constrain the
 * response to the request's Zod schema; no tools are offered, so the model can
 * only return data — it can never act.
 */
export class AnthropicProvider extends AiProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    super();
    // One retry at most: limits run on our side and a user is waiting.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async generate<T>(request: AiGenerateRequest<T>): Promise<AiGenerateResult<T>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.content.map(toBlock) }],
        output_config: { format: betaZodOutputFormat(request.schema), effort: request.effort },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
    } catch (error) {
      throw this.mapError(error);
    }

    const usage = usageOf(response.usage);
    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('REFUSED', 'The model declined this request', usage);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError('INVALID_OUTPUT', 'The answer was cut off', usage);
    }
    // parse() already validated against the schema; re-check so a null or a
    // schema drift between SDK and Zod can never reach feature code.
    const checked = request.schema.safeParse(response.parsed_output);
    if (!checked.success) {
      throw new AiProviderError('INVALID_OUTPUT', 'The answer did not match the schema', usage);
    }
    return { output: checked.data, model: response.model, usage };
  }

  private mapError(error: unknown): AiProviderError {
    if (error instanceof Anthropic.RateLimitError) {
      return new AiProviderError('RATE_LIMITED', 'Provider rate limit reached');
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new AiProviderError('TIMEOUT', 'Provider timed out');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new AiProviderError('UNAVAILABLE', 'Provider unreachable');
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError ||
      error instanceof Anthropic.NotFoundError ||
      error instanceof Anthropic.BadRequestError
    ) {
      // Operator problem (key, model id, request shape). Logged without content.
      this.logger.error(
        { status: error.status, type: error.name },
        'AI provider rejected the request',
      );
      return new AiProviderError('CONFIG', 'Provider rejected the request');
    }
    if (error instanceof Anthropic.APIError) {
      return new AiProviderError('UNAVAILABLE', `Provider error ${String(error.status)}`);
    }
    if (error instanceof Anthropic.AnthropicError) {
      // e.g. the SDK could not parse the JSON it received.
      return new AiProviderError('INVALID_OUTPUT', 'Provider returned unreadable output');
    }
    return new AiProviderError('UNAVAILABLE', 'Unexpected provider failure');
  }
}
