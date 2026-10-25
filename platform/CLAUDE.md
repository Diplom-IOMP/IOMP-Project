# IOMP platform

Zone: `platform/`, `docs/platform/`, `docs/adr/ADR-PL-*`, `.github/workflows/platform.yml`. Everything else is read-only.
Spec: `docs/specs/technical-specification.md` (IDs `FR-*`, `NFR-*`, `TEST-*`, `ASSUMPTION-*`). Section 8 (API and integrations) is normative for the public API.

- The public API is `contracts/openapi/iomp-v1.yaml`. Implement what it says, exactly: field names, status codes, problem `code` values, ETag and `Idempotency-Key` semantics. If the code needs something the contract does not have, stop and propose a `contract/<topic>` PR first.
- `contracts/fixtures/` are acceptance tests: the platform must accept every fixture request and answer as recorded. Run them in CI once `events:ingest` exists.
- v1 is additive only. Never rename, remove or retype a field, never tighten validation of an existing field; breaking changes go to `/api/v2`.
- The agent is an ordinary data source with a service account. Never add agent-specific endpoints (`/api/v1/agents/*`, registration, remote config, commands); see ADR-CT-001, GAP-AG-008.
- `agent.heartbeat` updates source freshness only and never opens an alert. Opening and recovery of one condition share a fingerprint (`event_type` + `condition_id`, spec 4.4).
- Never import from `agent/`. Generate DTOs from `contracts/openapi/` inside `platform/`.
- Dependency manifests and lock files live under `platform/`, not the repo root.
- Stack: ADR-PL-001 (NestJS/Fastify API and workers, PostgreSQL, React/Vite SPA, pnpm workspace). New infrastructure gets its own ADR first.
- Commands, from `platform/`: `pnpm install`, `pnpm gen:api-types` (after any contract change), `pnpm typecheck`, `pnpm build`, `pnpm test`. Dev: `pnpm --filter @iomp/api build && pnpm --filter @iomp/api start`, `pnpm --filter @iomp/web dev`.
- Public API types come only from `@iomp/api-types` (generated, git-ignored). Never hand-write DTOs for `/api/v1`.
