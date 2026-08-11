import { Module } from '@nestjs/common';
import { AiCredentialsResolver } from './ai-credentials.resolver';
import { AI_EMBEDDING_PROVIDER, AI_PROVIDER } from './ai-provider.interface';
import { GeminiProvider } from './gemini.provider';

@Module({
  providers: [
    GeminiProvider,
    { provide: AI_PROVIDER, useExisting: GeminiProvider },
    { provide: AI_EMBEDDING_PROVIDER, useExisting: GeminiProvider },
    AiCredentialsResolver,
  ],
  exports: [AI_PROVIDER, AI_EMBEDDING_PROVIDER, AiCredentialsResolver],
})
export class AiProviderModule {}
