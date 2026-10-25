# ADR-PL-002: Database access, migrations and ingest persistence

- Status: Accepted
- Deciders: @mutednew (platform)
- Date: 2026-10-25
- Issue: #10

## Context

ADR-PL-001 left the PostgreSQL access layer and the migration tool to the first ingest PR. `POST /api/v1/events:ingest` needs API key authentication with source binding, an idempotency ledger, delivery dedup, per-source quotas and durable receipts, and must answer every fixture in `contracts/fixtures/events-ingest/` as recorded. There is no broker yet (ADR-PL-001).

## Decision

| Concern | Choice |
| --- | --- |
| Access layer | `pg` (node-postgres) with hand-written SQL. No ORM: the ingest path needs exact control over locks, `ON CONFLICT` and transactions, and the schema is small |
| Migrations | Ordered SQL strings in `apps/api/src/db/migrations.ts`, applied by `runMigrations()` at API startup under an advisory lock and recorded in `schema_migrations`. An applied migration is never edited |
| Request validation | Ajv (JSON Schema 2020-12) compiled from the contract itself: `pnpm gen:api-types` also writes the OpenAPI document and `event-types.yaml` as JSON into `@iomp/api-types`. No hand-written validation schemas |
| API keys | `iomp_<prefix>_<secret>`; the prefix is the lookup key, only SHA-256 of the secret is stored and compared in constant time. Keys are random and high-entropy, so a slow password hash brings nothing |
| Idempotency | `idempotency_records`, scoped by service account + method + path + key, SHA-256 of the decoded body, TTL 7 days. Requests with the same key are serialized with a transaction-scoped advisory lock. Only 202 receipts are stored; 409, 413, 422, 429 and 503 are not, so a retry after them is processed again |
| Dedup | `events` has `UNIQUE (source_id, source_event_id, source_revision)`. The batch locks its `data_sources` row first, so concurrent batches of one source cannot insert the same event twice |
| Quota | Token bucket per source on the `data_sources` row (default 100 events/s, burst 500, platform spec 8.3). A batch whose new events exceed the tokens gets 429 with `Retry-After` and nothing is accepted |
| Durability | Receipt, events and idempotency record are written in one transaction before 202 is returned |
| Tests | Real PostgreSQL through `DATABASE_URL` (a `postgres:16` service in CI). Without it the database suites are skipped locally; CI always sets it |

## Consequences

- Ingest runs on Node and PostgreSQL only; when the broker arrives (its own ADR), the transaction writes an outbox row instead of being the end of the pipeline.
- Holding the source row lock serializes ingest per source. That is acceptable at the MVP rate (100 events/s per source by default) and is revisited with the broker.
- There is no API to create data sources, service accounts or keys yet (`POST /api/v1/api-keys` and friends come with IAM). Until then they are inserted directly, as the tests do.
