import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Schemas } from '@iomp/api-types';
import type { PoolClient } from 'pg';
import type { Principal } from '../auth/api-key.guard';
import { CLOCK, type Clock } from '../common/clock';
import { INVALID_JSON } from '../common/http';
import { ProblemError, schemaValidationFailed } from '../common/problem';
import {
  checkEventTypeRules,
  eventTypeRegistered,
  fieldOf,
  validateIngestEnvelope,
  validateInputEvent,
} from '../contract/contract';
import { Database } from '../db/database';
import { fingerprint } from './fingerprint';

type IngestRequest = Schemas['IngestRequest'];
type InputEvent = Schemas['InputEvent'];
type IngestReceipt = Schemas['IngestReceipt'];
type ReceiptItem = Schemas['ReceiptItem'];

export interface IngestCall {
  principal: Principal;
  method: string;
  path: string;
  idempotencyKey: string | string[] | undefined;
  body: unknown;
  rawBody: Buffer | undefined;
}

export interface IngestResult {
  status: number;
  body: IngestReceipt;
}

const MAX_EVENTS = 500;
const MAX_EVENT_BYTES = 256 * 1024;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const LATE_AFTER_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{16,128}$/;

interface SourceQuota {
  quota_events_per_second: number;
  quota_burst: number;
  quota_tokens: number;
  quota_refilled_at: Date;
}

interface Candidate {
  index: number;
  event: InputEvent;
  revision: string;
}

// POST /api/v1/events:ingest (contract iomp-v1, ADR-CT-001 GAP-AG-002).
@Injectable()
export class IngestService {
  constructor(
    private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async ingest(call: IngestCall): Promise<IngestResult> {
    const key = call.idempotencyKey;
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
      throw schemaValidationFailed(
        [{ field: 'Idempotency-Key', code: key === undefined ? 'REQUIRED' : 'INVALID_FIELD' }],
        'Idempotency-Key must be 16-128 printable ASCII characters',
      );
    }
    const request = this.parseEnvelope(call.body);
    if (!call.principal.sourceIds.includes(request.source_id)) {
      throw new ProblemError(403, 'SOURCE_MISMATCH', 'Credential is not bound to this source', {
        detail: 'source_id is not bound to the API key',
      });
    }
    const requestHash = createHash('sha256')
      .update(call.rawBody ?? Buffer.from(JSON.stringify(call.body)))
      .digest();

    return this.db.transaction(async (tx) => {
      const scope = [call.principal.serviceAccountId, call.method, call.path, key] as const;
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope.join('\n')]);

      const now = this.clock.now();
      const stored = await tx.query<{ request_sha256: Buffer; status_code: number; response_body: IngestReceipt }>(
        `SELECT request_sha256, status_code, response_body FROM idempotency_records
          WHERE principal_id = $1 AND method = $2 AND path = $3 AND key = $4 AND expires_at > $5`,
        [...scope, now],
      );
      const previous = stored.rows[0];
      if (previous) {
        if (!previous.request_sha256.equals(requestHash)) {
          throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different body', {
            detail: 'The key was first used with a different payload hash',
          });
        }
        return { status: previous.status_code, body: previous.response_body };
      }

      const receipt = await this.accept(tx, request, now);
      await tx.query(
        `INSERT INTO idempotency_records
           (principal_id, method, path, key, request_sha256, status_code, response_body, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 202, $6, $7, $8)
         ON CONFLICT (principal_id, method, path, key) DO UPDATE
           SET request_sha256 = EXCLUDED.request_sha256, status_code = EXCLUDED.status_code,
               response_body = EXCLUDED.response_body, created_at = EXCLUDED.created_at,
               expires_at = EXCLUDED.expires_at`,
        [...scope, requestHash, receipt, now, new Date(now.getTime() + IDEMPOTENCY_TTL_MS)],
      );
      return { status: 202, body: receipt };
    });
  }

  private parseEnvelope(body: unknown): IngestRequest {
    if (body === INVALID_JSON || body === undefined) {
      throw schemaValidationFailed([{ code: 'INVALID_JSON' }], 'Body is not valid JSON');
    }
    const events = (body as { events?: unknown } | null)?.events;
    if (Array.isArray(events) && events.length > MAX_EVENTS) {
      throw new ProblemError(413, 'BATCH_TOO_LARGE', 'Batch exceeds limits', {
        detail: 'At most 500 events and 5 MiB per batch',
        errors: [{ field: '/events', code: 'MAX_ITEMS', detail: `${events.length} > ${MAX_EVENTS}` }],
      });
    }
    if (!validateIngestEnvelope(body)) {
      const errors = (validateIngestEnvelope.errors ?? []).map((error) => {
        const field = fieldOf(error);
        return { field, code: field === '/schema_version' ? 'UNSUPPORTED_VERSION' : 'INVALID_FIELD' };
      });
      const version = errors.some((error) => error.code === 'UNSUPPORTED_VERSION');
      throw schemaValidationFailed(errors, version ? 'Unsupported schema_version major' : 'Invalid envelope');
    }
    return body as IngestRequest;
  }

  private async accept(tx: PoolClient, request: IngestRequest, now: Date): Promise<IngestReceipt> {
    const items: ReceiptItem[] = [];
    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    request.events.forEach((event, index) => {
      const rejection = this.check(event, now);
      const sourceEventId = typeof event?.source_event_id === 'string' ? event.source_event_id : '';
      if (rejection) {
        items[index] = { index, source_event_id: sourceEventId, status: 'Rejected', error: rejection };
        return;
      }
      const revision = event.source_revision ?? '';
      const dedupKey = JSON.stringify([event.source_event_id, revision]);
      if (seen.has(dedupKey)) {
        items[index] = {
          index,
          source_event_id: sourceEventId,
          status: 'Rejected',
          error: {
            code: 'DUPLICATE_IN_BATCH',
            retryable: false,
            field: '/source_event_id',
            detail: 'The same event appears earlier in this batch',
          },
        };
        return;
      }
      seen.add(dedupKey);
      candidates.push({ index, event, revision });
    });

    // The source row lock serializes batches of one source, so the dedup lookup below cannot
    // race with a concurrent insert of the same event.
    const quota = await this.lockSource(tx, request.source_id);
    const existing = await this.findExisting(tx, request.source_id, candidates);
    const fresh = candidates.filter((c) => !existing.has(JSON.stringify([c.event.source_event_id, c.revision])));
    await this.takeQuota(tx, request.source_id, quota, fresh.length, now);

    const receiptId = randomUUID();
    for (const candidate of candidates) {
      const { index, event, revision } = candidate;
      const original = existing.get(JSON.stringify([event.source_event_id, revision]));
      if (original) {
        items[index] = { index, source_event_id: event.source_event_id, event_id: original, status: 'Duplicate' };
        continue;
      }
      const eventId = randomUUID();
      const occurredAt = new Date(event.timestamp);
      await tx.query(
        `INSERT INTO events (event_id, source_id, source_event_id, source_revision, receipt_id, event_type,
           severity, status, source_object_id, condition_id, fingerprint, occurred_at, ingested_at, late, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          eventId,
          request.source_id,
          event.source_event_id,
          revision,
          receiptId,
          event.event_type,
          event.severity,
          event.status,
          event.source_object_id ?? null,
          event.condition_id ?? null,
          fingerprint(request.source_id, event),
          occurredAt,
          now,
          now.getTime() - occurredAt.getTime() > LATE_AFTER_MS,
          event,
        ],
      );
      items[index] = { index, source_event_id: event.source_event_id, event_id: eventId, status: 'Accepted' };
    }

    if (fresh.length > 0) {
      // agent.heartbeat is a freshness signal only (GAP-AG-005): it never opens an alert.
      const heartbeat = fresh.some((c) => c.event.event_type === 'agent.heartbeat');
      await tx.query(
        `UPDATE data_sources SET last_event_at = $2,
           last_heartbeat_at = CASE WHEN $3 THEN $2 ELSE last_heartbeat_at END
         WHERE id = $1`,
        [request.source_id, now, heartbeat],
      );
    }

    const rejected = items.filter((item) => item.status === 'Rejected').length;
    return {
      receipt_id: receiptId,
      accepted_count: items.length - rejected,
      rejected_count: rejected,
      items,
      ingestion_timestamp: now.toISOString(),
    };
  }

  private check(event: unknown, now: Date): ReceiptItem['error'] | undefined {
    if (Buffer.byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) {
      return { code: 'EVENT_TOO_LARGE', retryable: false, detail: 'At most 256 KiB per event' };
    }
    if (!validateInputEvent(event)) {
      const first = validateInputEvent.errors?.[0];
      return {
        code: 'INVALID_FIELD',
        retryable: false,
        field: first ? fieldOf(first) : '/',
        detail: first?.message ?? 'Event does not match the schema',
      };
    }
    const valid = event as InputEvent;
    if (!eventTypeRegistered(valid.event_type)) {
      return {
        code: 'UNKNOWN_EVENT_TYPE',
        retryable: false,
        field: '/event_type',
        detail: 'event_type is not registered in contracts/event-types.yaml',
      };
    }
    const violation = checkEventTypeRules(valid);
    if (violation) {
      return { code: 'INVALID_FIELD', retryable: false, field: violation.field, detail: violation.detail };
    }
    if (new Date(valid.timestamp).getTime() - now.getTime() > FUTURE_SKEW_MS) {
      return {
        code: 'TIMESTAMP_IN_FUTURE',
        retryable: false,
        field: '/timestamp',
        detail: 'Timestamp is more than 5 minutes ahead of the server clock',
      };
    }
    return undefined;
  }

  private async findExisting(tx: PoolClient, sourceId: string, candidates: Candidate[]): Promise<Map<string, string>> {
    if (candidates.length === 0) return new Map();
    const { rows } = await tx.query<{ source_event_id: string; source_revision: string; event_id: string }>(
      `SELECT e.source_event_id, e.source_revision, e.event_id
         FROM events e
         JOIN unnest($2::text[], $3::text[]) AS k (source_event_id, source_revision)
           ON e.source_event_id = k.source_event_id AND e.source_revision = k.source_revision
        WHERE e.source_id = $1`,
      [sourceId, candidates.map((c) => c.event.source_event_id), candidates.map((c) => c.revision)],
    );
    return new Map(rows.map((row) => [JSON.stringify([row.source_event_id, row.source_revision]), row.event_id]));
  }

  private async lockSource(tx: PoolClient, sourceId: string): Promise<SourceQuota> {
    const { rows } = await tx.query<SourceQuota>(
      `SELECT quota_events_per_second, quota_burst, quota_tokens, quota_refilled_at
         FROM data_sources WHERE id = $1 FOR UPDATE`,
      [sourceId],
    );
    if (!rows[0]) throw new ProblemError(403, 'SOURCE_MISMATCH', 'Credential is not bound to this source');
    return rows[0];
  }

  // Token bucket per source (platform spec 8.1, TEST-023). 429 accepts nothing.
  private async takeQuota(
    tx: PoolClient,
    sourceId: string,
    source: SourceQuota,
    needed: number,
    now: Date,
  ): Promise<void> {
    const elapsed = Math.max(0, now.getTime() - source.quota_refilled_at.getTime()) / 1000;
    const tokens = Math.min(source.quota_burst, source.quota_tokens + elapsed * source.quota_events_per_second);
    if (needed > tokens) {
      const retryAfter = Math.max(1, Math.ceil((needed - tokens) / source.quota_events_per_second));
      throw new ProblemError(429, 'QUOTA_EXCEEDED', 'Quota exceeded', {
        detail: 'Ingest quota of this source is exhausted',
        retryAfterSeconds: retryAfter,
      });
    }
    await tx.query('UPDATE data_sources SET quota_tokens = $2, quota_refilled_at = $3 WHERE id = $1', [
      sourceId,
      tokens - needed,
      now,
    ]);
  }
}
