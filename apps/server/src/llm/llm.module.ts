import { Global, Module } from '@nestjs/common';
import { LlmClient } from './llm-client';

@Global()
@Module({ providers: [LlmClient], exports: [LlmClient] })
export class LlmModule {}
