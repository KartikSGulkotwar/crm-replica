import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { setupApp } from './setup-app';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(env.PORT);
  Logger.log(`API ready on http://localhost:${env.PORT}/api (docs: /api/docs)`, 'Bootstrap');
}

void bootstrap();
