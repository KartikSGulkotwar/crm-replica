import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // No HTTP server: the worker only consumes BullMQ queues.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log(`Worker ready (pid ${process.pid}), listening for jobs`, 'Bootstrap');
}

void bootstrap();
