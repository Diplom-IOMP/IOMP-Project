import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createTestApp, databaseUrl, resetAndSeed, type TestApp } from '../testing/support';

// Replays contracts/fixtures/events-ingest by the rules in contracts/fixtures/README.md.

interface Fixture {
  description: string;
  preconditions: string[];
  server_time?: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
    body_generator?: string;
  };
  response: { status: number; headers: Record<string, string>; body: Record<string, unknown> };
}

const dir = resolve(__dirname, '../../../../../contracts/fixtures/events-ingest');
const load = (name: string): Fixture => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Fixture;
const names = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Bodies the fixtures describe in words (`body_generator`).
function requestBody(name: string, fixture: Fixture): unknown {
  if (fixture.request.body !== null) return fixture.request.body;
  if (name === '413-batch-too-large') {
    const base = load('202-full').request.body as { events: { source_event_id: string }[] };
    const events = Array.from({ length: 501 }, (_, n) => ({
      ...base.events[0]!,
      source_event_id: `orders-health:cycle-42:opened:1:${n}`,
    }));
    return { ...(base as object), events };
  }
  throw new Error(`No generator for ${name}: ${fixture.request.body_generator}`);
}

describe('events:ingest fixtures', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, () => {
  let t: TestApp;

  before(async () => {
    t = await createTestApp();
  });

  after(async () => {
    await t?.app.close();
  });

  async function send(name: string, apiKey: string) {
    const fixture = load(name);
    t.clock.fixed = fixture.server_time ? new Date(fixture.server_time) : undefined;
    const res = await t.app.inject({
      method: fixture.request.method as 'POST',
      url: fixture.request.path,
      headers: { ...fixture.request.headers, 'X-API-Key': apiKey },
      payload: JSON.stringify(requestBody(name, fixture)),
    });
    return { fixture, res };
  }

  for (const name of names) {
    test(name, async () => {
      const expected = load(name);
      const seed = await resetAndSeed(t.db, { quotaTokens: expected.response.status === 429 ? 0 : undefined });

      // event_id the server returned for each source_event_id while replaying the preconditions.
      const known = new Map<string, string>();
      for (const pre of expected.preconditions) {
        const { fixture, res } = await send(pre, seed.apiKey);
        assert.equal(res.statusCode, fixture.response.status, `precondition ${pre}`);
        for (const item of (res.json() as { items?: { source_event_id: string; event_id?: string }[] }).items ?? []) {
          if (item.event_id) known.set(item.source_event_id, item.event_id);
        }
      }

      const { res } = await send(name, seed.apiKey);
      assert.equal(res.statusCode, expected.response.status, res.body);
      compareHeaders(expected.response.headers, res.headers);
      compareBody(expected.response.body, res.json() as Record<string, unknown>, known, expected.server_time);
    });
  }
});

function compareHeaders(expected: Record<string, string>, actual: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(expected)) {
    const got = actual[name.toLowerCase()];
    if (name === 'Content-Type') {
      assert.equal(String(got).split(';')[0]?.trim(), value);
    } else if (name === 'Retry-After') {
      assert.match(String(got), /^[1-9][0-9]*$/);
    } else {
      assert.equal(got, value, name);
    }
  }
}

function compareBody(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  known: Map<string, string>,
  serverTime: string | undefined,
): void {
  if ('receipt_id' in expected) {
    assert.match(String(actual.receipt_id), UUID);
    const at = String(actual.ingestion_timestamp);
    assert.ok(!Number.isNaN(Date.parse(at)), 'ingestion_timestamp is a date-time');
    if (serverTime) assert.ok(Date.parse(at) >= Date.parse(serverTime), 'ingestion_timestamp >= server_time');
    assert.equal(actual.accepted_count, expected.accepted_count);
    assert.equal(actual.rejected_count, expected.rejected_count);

    const want = expected.items as Record<string, unknown>[];
    const got = actual.items as Record<string, unknown>[];
    assert.equal(got.length, want.length, 'items');
    const fresh = new Set(known.values());
    want.forEach((item, i) => {
      const g = got[i]!;
      assert.equal(g.index, item.index);
      assert.equal(g.source_event_id, item.source_event_id);
      assert.equal(g.status, item.status);
      if (item.status === 'Accepted') {
        assert.match(String(g.event_id), UUID);
        assert.ok(!fresh.has(String(g.event_id)), 'Accepted event_id is new');
        fresh.add(String(g.event_id));
      } else if (item.status === 'Duplicate') {
        assert.equal(g.event_id, known.get(String(item.source_event_id)), 'Duplicate keeps the original event_id');
      } else {
        const e = item.error as Record<string, unknown>;
        const a = g.error as Record<string, unknown>;
        assert.equal(a.code, e.code);
        assert.equal(a.retryable, e.retryable);
        assert.equal(a.field, e.field);
        assert.equal(typeof a.detail, typeof e.detail);
      }
    });
    return;
  }

  // Problem details.
  assert.match(String(actual.request_id), UUID);
  for (const field of ['type', 'status', 'code', 'instance']) {
    assert.equal(actual[field], expected[field], field);
  }
  for (const field of ['title', 'detail']) {
    if (field in expected) assert.equal(typeof actual[field], 'string', field);
  }
  if ('errors' in expected) {
    const strip = (errors: unknown) =>
      (errors as Record<string, unknown>[]).map(({ field, code }) => ({ field, code }));
    assert.deepEqual(strip(actual.errors), strip(expected.errors));
  }
  if ('retry_after_seconds' in expected) {
    assert.ok(Number.isInteger(actual.retry_after_seconds) && Number(actual.retry_after_seconds) >= 1);
  }
}
