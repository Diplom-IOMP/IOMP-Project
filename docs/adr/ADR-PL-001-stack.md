# ADR-PL-001: Platform stack

- Status: Accepted
- Deciders: @mutednew (platform)
- Date: 2026-10-25
- Issue: #9

## Context

The platform spec (sections 3, 6 and 15.4) describes a modular monolith with background processors, a relational core (CMDB, topology, incidents, audit, outbox), a broker for the ingest pipeline, separate stores for metrics and events, an OIDC IdP and a web UI. The first platform milestone is `POST /api/v1/events:ingest` passing `contracts/fixtures/` (#10). Everything the agent sees is fixed by `contracts/openapi/iomp-v1.yaml`.

Requirements that drive the choice:

- Long-running workers next to the API: normalization, correlation, outbox delivery, notifications, the SSE stream.
- Full control over request handling in ingest: body size and decompression limits, `Idempotency-Key`, RFC 9457 problem responses, per-item receipts.
- Types for the public API generated from the contract on the platform side, never hand-written.
- The UI is an internal operations console behind a login: no SEO, no public pages. The OIDC flow already lives in the API (`/api/v1/auth/login`, `/callback`, session cookie).

## Decision

| Concern | Choice |
| --- | --- |
| Language | TypeScript, Node.js 22 LTS |
| Repository layout | pnpm workspace in `platform/`: `apps/api`, `apps/web`, `packages/api-types`; workers are added as `apps/workers` when the first one is needed |
| API and workers | NestJS 11 on the Fastify adapter. Modules per bounded context; workers reuse the same modules as separate processes |
| Contract types | `openapi-typescript` generates `packages/api-types` from `contracts/openapi/iomp-v1.yaml` on every build; request validation uses the same schemas |
| Database | PostgreSQL 16: CMDB, topology (recursive CTE), incidents, audit, idempotency inbox, outbox. Access layer and migration tool are chosen in the ingest PR (#10) |
| UI | React 19 single-page app built with Vite. Served as static files next to the API, so there is no separate UI server. Next.js was rejected: SSR and server components bring nothing to an internal console and add a second Node server in production |
| Tests | Node built-in test runner (`node:test`) with Nest's Fastify `inject` for HTTP tests; contract tests replay `contracts/fixtures/` |
| CI | `.github/workflows/platform.yml`: install, typecheck, build, test on changes to `platform/` or `contracts/openapi/` |

Added later, each with its own ADR when the first task needs it (the target set from the platform spec): broker for the ingest pipeline (NATS JetStream is the default candidate), event/log store (ClickHouse), metrics store (VictoriaMetrics), OpenTelemetry Collector for OTLP intake, object storage (MinIO), OIDC IdP (Keycloak), Docker Compose and Helm for deployment.

## Consequences

- One language for API, workers and UI; contract types are shared by generation, not by imports from `agent/`.
- The first milestone needs only Node and PostgreSQL, so `events:ingest` can be built and tested against the fixtures early.
- Infrastructure grows with the features that need it; until a broker exists, ingest writes the durable receipt to PostgreSQL in the same transaction as the idempotency record, which keeps the 202 semantics of the contract.
