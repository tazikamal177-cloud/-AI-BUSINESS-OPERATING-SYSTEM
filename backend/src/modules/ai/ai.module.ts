import { Global, Module } from '@nestjs/common';
import { OpenAiProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { AiService } from './ai.service';

@Global()
@Module({
  providers: [OpenAiProvider, AnthropicProvider, GeminiProvider, AiGatewayService, AiService],
  exports: [AiGatewayService, AiService, OpenAiProvider, AnthropicProvider, GeminiProvider],
})
export class AiModule {}
