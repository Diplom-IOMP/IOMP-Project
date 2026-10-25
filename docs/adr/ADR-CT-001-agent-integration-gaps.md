# ADR-CT-001: Answers to the agent integration gaps (GAP-AG-001..008)

- Status: Proposed (contract v0)
- Deciders: @mutednew (platform), @Rewer2022 (agent)
- Date: 2026-10-25

## Context

The agent spec (section 8.6) lists eight details the platform spec leaves open. The agent may use only existing platform APIs, so each answer below either picks one option the platform spec already allows or confirms an existing rule. Nothing here adds an endpoint. The machine-readable form is `contracts/openapi/iomp-v1.yaml`, `contracts/otlp-profile.yaml` and `contracts/fixtures/`.

## Decisions

### GAP-AG-001: agent authentication

- Profile for v1: **API key** of a service account (platform spec NFR-SEC-007 allows "hashed API keys"). Header `X-API-Key: iomp_<prefix>_<secret>`. No Bearer form for API keys.
- Provisioning is out of band: an administrator creates the data source, a service account with `events.ingest`, `data.read`, `ci.write`, `topology.write`, and issues the key with the existing `POST /api/v1/api-keys`. The secret is shown once. Expiry is at most 90 days; rotation issues a second key for the same service account, so replay under the same principal stays safe.
- Credential-to-source binding: the service account is bound to the data source. A request whose `source_id` (or CI `data_source_id`) is not bound to the key returns 403 `SOURCE_MISMATCH`.
- TLS is required. mTLS is a deployment option for the gateway and does not replace the key. No token audience applies to API keys.
- OAuth client-credentials for service accounts may be added later as an additional security scheme (additive change); v0 clients need only the API key.

### GAP-AG-002: partial 202 and retry classes

- 202 is returned after durable acceptance. `items` has exactly one entry per input event, with `index` (position in the request) and `source_event_id`.
- Item status: `Accepted` (new, has `event_id`), `Duplicate` (dedup hit, has the original `event_id`), `Rejected` (has `error`).
- `accepted_count` counts `Accepted` and `Duplicate`; `rejected_count` counts `Rejected`; together they equal the number of input events. A receipt that breaks this is an uncertain delivery for the client.
- `error.retryable=false` is permanent: `INVALID_FIELD`, `EVENT_TOO_LARGE`, `TIMESTAMP_IN_FUTURE`, `UNKNOWN_EVENT_TYPE`, `DUPLICATE_IN_BATCH`. `error.retryable=true` may be resent in a new batch with a new key: `SOURCE_QUOTA_EXCEEDED`, `TEMPORARILY_UNAVAILABLE`. Unknown future codes follow their `retryable` flag.
- Whole-request outcomes: invalid envelope 422, too large 413, quota 429 with `Retry-After`, dependency 503 with `Retry-After`. For 413, 422, 429 and 503 nothing is accepted.
- Same `Idempotency-Key` and same body returns the first receipt byte-for-byte equivalent; a different body returns 409 `IDEMPOTENCY_CONFLICT`.

### GAP-AG-003: CI lookup and ETag

- Lookup: `GET /api/v1/cis?data_source_id=<uuid>&source_object_id=<id>` returns at most one CI, because `(data_source_id, source_object_id)` is unique. No `GET /cis/{id}` is needed.
- Every CI has an integer `version`. The ETag is that value quoted (`"7"`): returned in the `ETag` header of POST and PATCH and readable from `version` in list items. `If-Match` takes the same form.
- `POST /cis` with an existing identity returns 409 `CI_IDENTITY_CONFLICT` with `existing_id`.
- A service account creates CIs only as `Proposed` and may patch only `name`, `ip_addresses`, `dns_names`, `tags`, `technical_attributes`, `last_synced_at`. Business fields (owner, support group, criticality, location, lifecycle) belong to people; writing them returns 403 `FIELD_NOT_WRITABLE`, a manually locked field returns 403 `FIELD_LOCKED`.

### GAP-AG-004: OTLP routes and auth

- OTLP/HTTP Protobuf at `https://<host>/otlp/v1/{metrics,logs,traces}`, not under `/api/v1`. gRPC is not offered in v0.
- Auth is the same `X-API-Key`; the source comes from the key's binding, never from resource attributes. OTLP routes need a key bound to exactly one source.
- Retry: 429/502/503/504 with backoff and `Retry-After`; partial success is terminal. Details in `contracts/otlp-profile.yaml`.

### GAP-AG-005: heartbeat

- Through `POST /api/v1/events:ingest`, `event_type=agent.heartbeat`, `severity=Info`, `status=Unknown`, no `condition_id`, `source_object_id` = stable host identity.
- The platform treats `agent.heartbeat` as a freshness signal: it updates the data source state (Fresh/Stale/Unavailable, platform spec FR-INGEST-007) and never opens an alert. Stale after 3 missed `expected_interval` (default 60 s).
- Payload fields beyond the envelope (labels such as agent version and profile) are defined by the agent owner in `contracts/event-types.yaml`.

### GAP-AG-006: stable fingerprint

- Fingerprint v1 = `sha256(scope, source_id, canonical_ci_or_source_object, event_type, condition_id, fingerprint_labels)`, as in platform spec 4.4. Message, title, timestamp, severity and status are never part of it.
- `fingerprint_labels` are only the labels that `contracts/event-types.yaml` lists for that event type; empty by default. Other labels never change the fingerprint.
- Opening (`Active`) and recovery (`Cleared`) with the same `source_id`, `source_object_id`, `event_type`, `condition_id` and fingerprint labels belong to one alert cycle. A golden fixture proves this once `event-types.yaml` exists.

### GAP-AG-007: default status of a new edge

- `POST /api/v1/topology/relationships` has no `status` field; every created edge is `Proposed`.
- Only people change `status`. A service account may refresh `confidence`, `evidence` and `observed_at` on edges of its own source. A person's Confirmed or Rejected decision is never reverted by a source.
- An existing active edge with the same `(from_ci_id, to_ci_id, type)` returns 409 `RELATIONSHIP_EXISTS` with `existing_id`.

### GAP-AG-008: fleet management

Confirmed: v1 has no fleet-management API (registration, remote config, commands, package distribution). The agent is managed locally. A future fleet API would be a separate contract change.

## Consequences

- The agent can build delivery, receipts, inventory reconciliation and the mock IOMP from the contract and fixtures without waiting for the platform.
- The platform must implement exactly these semantics; the fixtures are its acceptance tests for `events:ingest`.
- Any change to these answers is a `contract/` PR with a `CHANGELOG.md` entry.
