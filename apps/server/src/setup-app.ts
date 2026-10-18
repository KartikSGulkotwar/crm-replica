import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and the e2e tests so both run the exact same app configuration. */
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.use(cookieParser());
  // Behind Railway's proxy: use the client's IP (X-Forwarded-For) for rate limiting.
  (app as NestExpressApplication).set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('CRM Replica API')
    .setDescription('REST API for the CRM. Record endpoints are generated from the data model.')
    .setVersion('0.1.0')
    .addCookieAuth('crm_session')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
}
