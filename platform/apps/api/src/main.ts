import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { appOptions, configureApp, createAdapter } from './common/http';
import { Database, runMigrations } from './db/database';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(), appOptions);
  configureApp(app);
  await runMigrations(app.get(Database).pool);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}

void bootstrap();
