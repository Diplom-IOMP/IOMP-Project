import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createTestApp, databaseUrl, type TestApp } from '../testing/support';
import { runAdmin, UsageError } from './admin';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../contracts/fixtures/events-ingest/202-full.json'), 'utf8'),
) as { request: { body: { events: unknown[] } } };

describe('admin CLI', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, () => {
  let t: TestApp;

  before(async () => {
    t = await createTestApp();
    await t.db.pool.query(
      'TRUNCATE events, idempotency_records, api_keys, service_account_sources, service_accounts, data_sources',
    );
  });
  after(async () => {
    await t?.app.close();
  });

  const admin = (...args: string[]) => runAdmin(args, t.db.pool);
  const ingest = (key: string, sourceId: string, idempotencyKey: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/events:ingest',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key, 'Idempotency-Key': idempotencyKey },
      payload: JSON.stringify({ schema_version: '1.0', source_id: sourceId, events: fixture.request.body.events }),
    });

  test('a source, account and key created by the CLI can ingest, and a revoked key cannot', async () => {
    const sourceId = (await admin('create-source', '--name', 'host-a', '--type', 'iomp_agent')).split(' ')[1]!;
    const accountId = (
      await admin('create-account', '--name', 'agent-a', '--permissions', 'events.ingest', '--sources', sourceId)
    ).split(' ')[1]!;
    const key = /^key (\S+)/.exec(await admin('create-key', '--account', accountId, '--days', '30'))![1]!;
    assert.match(key, /^iomp_[0-9a-f]{12}_\S+$/);

    assert.equal((await ingest(key, sourceId, 'cli-test-key-0000001')).statusCode, 202);

    const prefix = key.split('_')[1]!;
    assert.equal(await admin('revoke-key', '--prefix', prefix), 'revoked');
    assert.equal((await ingest(key, sourceId, 'cli-test-key-0000002')).statusCode, 401);
  });

  test('bad arguments are usage errors', async () => {
    await assert.rejects(admin('create-source', '--name', 'x'), UsageError);
    await assert.rejects(admin('create-key', '--account', 'x', '--days', '91'), UsageError);
    await assert.rejects(admin('nope'), UsageError);
  });
});
