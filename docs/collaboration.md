# Working together in this repository

Two people work here, each with their own Claude Code: @Rewer2022 owns the agent, @mutednew owns the platform. Conflicts are avoided by giving each person their own directory and letting the two parts meet only through `contracts/`.

Per the specs, the agent talks to IOMP only through existing public APIs (`POST /api/v1/events:ingest`, OTLP/HTTP, `/api/v1/cis`, `/api/v1/topology/relationships`) and needs no new platform endpoints. That boundary is the boundary in the repository.

## Zones

| Zone | Paths | Owner |
| --- | --- | --- |
| agent | `agent/`, `docs/agent/`, `docs/adr/ADR-AG-*`, `.github/workflows/agent.yml` | @Rewer2022 |
| platform | `platform/`, `docs/platform/`, `docs/adr/ADR-PL-*`, `.github/workflows/platform.yml` | @mutednew |
| contracts | `contracts/`, `docs/adr/ADR-CT-*` | both, reviewed by the other |
| shared | everything else: root files, `.github/` (except own workflows), `docs/specs/` | both, reviewed by the other |

Rules:

- No code imports between `agent/` and `platform/`. Each side generates its DTOs from `contracts/openapi/`.
- No root-level dependency manifests or lock files. They live inside `agent/` or `platform/`.
- The agent's mock IOMP lives in `agent/test/mock-iomp` and serves `contracts/fixtures/`.
- A cross-product end-to-end test, once both sides run, lives in `e2e/` (shared zone).

## Branches and PRs

| Prefix | Changes only | Review |
| --- | --- | --- |
| `agent/<topic>` | agent zone | optional; owner may merge after green CI |
| `platform/<topic>` | platform zone | optional; owner may merge after green CI |
| `contract/<topic>` | contracts zone | required from the other owner |
| `repo/<topic>` | shared zone | required from the other owner |

1. One PR touches one zone. `zone-check` in `.github/workflows/contracts.yml` enforces this and the approval rule.
2. Squash merge only.
3. Rebase your own branch on `main` daily and before opening a PR. Never rebase or push to someone else's branch.
4. Several Claude Code sessions of one person use separate git worktrees and separate branches.
5. `main` is protected (owner sets it in Settings > Rules): PR required, `zone-check` required, no force pushes, no deletions.

## Contract

| Part | File | What it fixes |
| --- | --- | --- |
| Event ingest | `openapi/iomp-v1.yaml` | Envelope `schema_version`, `source_id`, `events[]`; dedup by `source_id` + `source_event_id`; `Idempotency-Key`; limits (500 events, 5 MiB per batch, 256 KiB per event); 202 with per-item receipts; RFC 9457 errors |
| Inventory and topology | `openapi/iomp-v1.yaml` | `GET/POST /api/v1/cis`, `PATCH /api/v1/cis/{id}` with ETag, `POST/PATCH /api/v1/topology/relationships`; which fields the agent may write; new edges are Proposed |
| Metrics, logs, traces | `otlp-profile.yaml` | OTLP/HTTP Protobuf, base URL, `/v1/metrics`, `/v1/logs`, `/v1/traces`, auth |
| Event types | `event-types.yaml` | Every agent `event_type` and `condition_id`, including `agent.heartbeat` and `health_check.failed` |
| Golden data | `fixtures/` | Agent requests and platform responses: full 202, partial 202, 409, 413, 422, 429 |

Open questions only the platform owner can close (agent spec 8.6), tracked as issues labelled `contract`:

- GAP-AG-001: agent authentication (API key header or OAuth, audience, certificate-to-source binding)
- GAP-AG-002: exact partial 202 schema and retry classes
- GAP-AG-003: CI lookup and where the ETag comes from
- GAP-AG-004: OTLP routes and auth
- GAP-AG-005: `agent.heartbeat` payload through `events:ingest`
- GAP-AG-006: stable fingerprint for opening and recovery
- GAP-AG-007: default status of a new edge
- GAP-AG-008: confirm that no fleet-management API is planned

## Claude Code setup

Claude Code reads the root `CLAUDE.md` and loads `agent/CLAUDE.md` or `platform/CLAUDE.md` when working in those directories. Personal habits go to `CLAUDE.local.md` (git-ignored).

Each person also blocks edits to the other zone in `.claude/settings.local.json` (git-ignored).

Agent owner:

```json
{
  "permissions": {
    "deny": ["Edit(/platform/**)", "Edit(/contracts/openapi/**)", "Bash(git push origin main:*)"]
  }
}
```

Platform owner:

```json
{
  "permissions": {
    "deny": ["Edit(/agent/**)", "Edit(/contracts/event-types.yaml)", "Bash(git push origin main:*)"]
  }
}
```

After setting it up, ask Claude to change a file in the other zone; the edit must be refused. Shell writes (`sed`, `>`) bypass this rule, which is why `zone-check` exists in CI.

## Start order

1. `repo/bootstrap` PR (this skeleton) - reviewed by the other owner.
2. Platform owner enables protection for `main`.
3. Contract v0 (`contract/v0`): platform owner writes the agent-facing subset of `/api/v1` from platform spec 8.1-8.2; agent owner adds `event-types.yaml` and the first fixtures from agent spec 8.2-8.3.
4. Then work in parallel. Each owner writes a stack ADR and adds build commands to their `CLAUDE.md`.
5. 15 minutes weekly over open `contract` issues.
6. When the platform accepts `events:ingest`, add the `e2e/` test: real agent to real platform.
