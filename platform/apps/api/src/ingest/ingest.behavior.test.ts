import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createTestApp, databaseUrl, resetAndSeed, type Seed, type TestApp } from '../testing/support';

// Behaviour of events:ingest that the fixtures do not cover.

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../contracts/fixtures/events-ingest/202-full.json'), 'utf8'),
) as { request: { body: { source_id: string; events: Record<string, unknown>[] } } };
const body = fixture.request.body;
const event = body.events[0]!;
const URL = '/api/v1/events:ingest';

describe('events:ingest', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, () => {
  let t: TestApp;
  let seed: Seed;

  before(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    seed = await resetAndSeed(t.db);
  });
  after(async () => {
    await t?.app.close();
  });

  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `test-key-${Math.random().toString(36).slice(2)}-0000`,
        'X-API-Key': seed.apiKey,
        ...headers,
      },
      payload: typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload),
    });

  test('same key and body returns the first receipt', async () => {
    const headers = { 'Idempotency-Key': 'ag-batch-replay-0000000001' };
    const first = await post(body, headers);
    const second = await post(body, headers);
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.deepEqual(second.json(), first.json());
  });

  test('a resent event in a new batch is a Duplicate with the original event_id', async () => {
    const first = (await post(body)).json() as { items: { event_id: string }[] };
    const second = (await post(body)).json() as { items: { event_id: string; status: string }[] };
    assert.equal(second.items[0]!.status, 'Duplicate');
    assert.equal(second.items[0]!.event_id, first.items[0]!.event_id);
  });

  test('concurrent batches with the same event store it once', async () => {
    const results = await Promise.all([post(body), post(body), post(body)]);
    const items = results.map((res) => (res.json() as { items: { event_id: string; status: string }[] }).items[0]!);
    assert.deepEqual(items.map((item) => item.status).sort(), ['Accepted', 'Duplicate', 'Duplicate']);
    assert.equal(new Set(items.map((item) => item.event_id)).size, 1);
  });

  test('concurrent requests with the same key return one receipt', async () => {
    const headers = { 'Idempotency-Key': 'ag-batch-concurrent-000001' };
    const results = await Promise.all([post(body, headers), post(body, headers)]);
    assert.deepEqual(results[0]!.json(), results[1]!.json());
  });

  test('a repeated event in one batch is rejected as DUPLICATE_IN_BATCH', async () => {
    const res = await post({ ...body, events: [event, event] });
    const receipt = res.json() as { accepted_count: number; items: { status: string; error?: { code: string } }[] };
    assert.equal(receipt.accepted_count, 1);
    assert.equal(receipt.items[1]!.error!.code, 'DUPLICATE_IN_BATCH');
  });

  test('invalid and unknown events are rejected per item', async () => {
    const res = await post({
      ...body,
      events: [
        { ...event, source_event_id: 'a', severity: 'Loud' },
        { ...event, source_event_id: 'b', event_type: 'custom.thing' },
      ],
    });
    assert.equal(res.statusCode, 202);
    const items = (res.json() as { items: { error: { code: string; field: string } }[] }).items;
    assert.deepEqual(items[0]!.error.code, 'INVALID_FIELD');
    assert.deepEqual(items[0]!.error.field, '/severity');
    assert.deepEqual(items[1]!.error.code, 'UNKNOWN_EVENT_TYPE');
  });

  test('missing or wrong API key is 401', async () => {
    assert.equal((await post(body, { 'X-API-Key': '' })).statusCode, 401);
    const wrong = await post(body, { 'X-API-Key': 'iomp_fixture_wrong' });
    assert.equal(wrong.statusCode, 401);
    assert.match(String(wrong.headers['content-type']), /^application\/problem\+json/);
  });

  test('a source not bound to the key is 403 SOURCE_MISMATCH', async () => {
    const res = await post({ ...body, source_id: '00000000-0000-4000-8000-000000000000' });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { code: string }).code, 'SOURCE_MISMATCH');
  });

  test('a key without events.ingest is 403', async () => {
    seed = await resetAndSeed(t.db, { permissions: ['data.read'] });
    const res = await post(body);
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { code: string }).code, 'PERMISSION_DENIED');
  });

  test('missing Idempotency-Key is 422', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: URL,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': seed.apiKey },
      payload: JSON.stringify(body),
    });
    assert.equal(res.statusCode, 422);
  });

  test('malformed JSON is 422', async () => {
    const res = await post('{"schema_version": ');
    assert.equal(res.statusCode, 422);
    assert.equal((res.json() as { code: string }).code, 'SCHEMA_VALIDATION_FAILED');
  });

  test('a body over 5 MiB is 413', async () => {
    const res = await post({ ...body, padding: 'x'.repeat(5 * 1024 * 1024) });
    assert.equal(res.statusCode, 413);
    assert.equal((res.json() as { code: string }).code, 'BATCH_TOO_LARGE');
  });

  test('a wrong Content-Type is 415', async () => {
    const res = await post('schema_version=1.0', { 'Content-Type': 'text/plain' });
    assert.equal(res.statusCode, 415);
    assert.match(String(res.headers['content-type']), /^application\/problem\+json/);
  });

  test('gzip bodies are accepted', async () => {
    const res = await post(gzipSync(JSON.stringify(body)), { 'Content-Encoding': 'gzip' });
    assert.equal(res.statusCode, 202, res.body);
  });

  test('gzip over a 20:1 ratio is 413', async () => {
    const res = await post(gzipSync(JSON.stringify({ ...body, padding: ' '.repeat(1024 * 1024) })), {
      'Content-Encoding': 'gzip',
    });
    assert.equal(res.statusCode, 413);
  });

  test('X-Correlation-ID is echoed when it is a UUID', async () => {
    const id = '5d1c2b7e-9a43-4f0e-b1d2-6c7a8e9f0a11';
    assert.equal((await post(body, { 'X-Correlation-ID': id })).headers['x-correlation-id'], id);
    assert.notEqual((await post(body, { 'X-Correlation-ID': 'nope' })).headers['x-correlation-id'], 'nope');
  });
});
