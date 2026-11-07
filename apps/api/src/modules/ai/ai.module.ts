import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { ReportsModule } from '../reports/reports.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DraftsService } from './drafts.service';
import { InsightsService } from './insights.service';
import { AiProvider, AiProviderError } from './providers/ai-provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { FakeProvider } from './providers/fake.provider';

/** Used when AI is off: any accidental call fails closed. */
class DisabledProvider extends AiProvider {
  readonly name = 'none';
  readonly model = 'none';
  generate(): Promise<never> {
    return Promise.reject(new AiProviderError('CONFIG', 'AI is disabled'));
  }
}

export function createAiProvider(config: AppConfig): AiProvider {
  if (!config.AI_ENABLED) return new DisabledProvider();
  switch (config.AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(
        config.AI_PROVIDER_API_KEY!,
        config.AI_MODEL,
        config.AI_TIMEOUT_MS,
      );
    case 'fake':
      return new FakeProvider();
    default:
      return new DisabledProvider();
  }
}

/** Phase 9: opt-in AI insights, transaction drafts and receipt OCR (ADR-024). */
@Module({
  imports: [ReportsModule],
  controllers: [AiController],
  providers: [
    { provide: AiProvider, inject: [APP_CONFIG], useFactory: createAiProvider },
    AiService,
    InsightsService,
    DraftsService,
  ],
})
export class AiModule {}
