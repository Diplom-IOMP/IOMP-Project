import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { CLOCK, type Clock } from '../common/clock';
import { appOptions, configureApp, createAdapter } from '../common/http';
import { generateApiKey } from '../auth/api-keys';
import { Database, runMigrations } from '../db/database';

// Test helpers for HTTP tests against a real PostgreSQL (DATABASE_URL). Never used by the app.

export const FIXTURE_SOURCE_ID = '6a79fd19-cdb1-4e2e-ae99-a9e8477d5001';
export const databaseUrl = process.env.DATABASE_URL;

export class TestClock implements Clock {
  fixed: Date | undefined;
  now(): Date {
    return this.fixed ?? new Date();
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  db: Database;
  clock: TestClock;
}

export async function createTestApp(): Promise<TestApp> {
  const clock = new TestClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(), appOptions);
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const db = app.get(Database);
  await runMigrations(db.pool);
  return { app, db, clock };
}

export interface Seed {
  sourceId: string;
  apiKey: string;
}

interface SeedOptions {
  sourceId?: string;
  permissions?: string[];
  quotaTokens?: number;
}

// Empties every table and creates one data source with a bound service account and API key.
export async function resetAndSeed(db: Database, options: SeedOptions = {}): Promise<Seed> {
  const sourceId = options.sourceId ?? FIXTURE_SOURCE_ID;
  await db.pool.query(
    'TRUNCATE events, idempotency_records, api_keys, service_account_sources, service_accounts, data_sources',
  );
  await db.pool.query(
    `INSERT INTO data_sources (id, name, type, quota_tokens, quota_events_per_second)
     VALUES ($1, 'fixture-agent', 'iomp_agent', $2, $3)`,
    [sourceId, options.quotaTokens ?? 500, options.quotaTokens === 0 ? 1 : 100],
  );
  const accountId = randomUUID();
  await db.pool.query('INSERT INTO service_accounts (id, name, permissions) VALUES ($1, $2, $3)', [
    accountId,
    'fixture-agent',
    options.permissions ?? ['events.ingest'],
  ]);
  await db.pool.query('INSERT INTO service_account_sources VALUES ($1, $2)', [accountId, sourceId]);
  const { key, prefix, secretSha256 } = generateApiKey();
  await db.pool.query(
    `INSERT INTO api_keys (id, service_account_id, prefix, secret_sha256, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '90 days')`,
    [randomUUID(), accountId, prefix, secretSha256],
  );
  return { sourceId, apiKey: key };
}
