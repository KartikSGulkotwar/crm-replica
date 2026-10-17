import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and the e2e tests so both run the exact same app configuration. */
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('CRM Replica API')
    .setDescription('REST API for the CRM. Record endpoints are generated from the data model.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
}
