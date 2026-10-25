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

1. One PR touches one zone, and the branch prefix names that zone. `zone-check` in `.github/workflows/contracts.yml` enforces this and the approval rule (after a review, `zone-recheck.yml` re-runs it): `contracts` and `shared` always need the other owner's approval, and a change to `agent` or `platform` made by someone other than its owner needs that owner's approval. Only an owner's latest review counts, so a later "changes requested" withdraws an approval, and reviews from anyone else are ignored. The script always runs from the base branch, so a PR cannot change its own gate. The only exception to one zone per PR is a `repo/*` branch (repo-wide maintenance), which may touch every zone but always needs the other owner's approval.
2. Squash merge only.
3. Rebase your own branch on `main` daily and before opening a PR. Never rebase or push to someone else's branch.
4. Several Claude Code sessions of one person use separate git worktrees and separate branches.
5. `main` is protected (owner sets it in Settings > Rules): PR required, `zone-check` required, no force pushes, no deletions.
   Contract checks in the same workflow: `openapi-lint` (Redocly), `openapi-breaking` (`oasdiff breaking` against the base branch, because v1 is additive only) and `fixtures` (every fixture matches the OpenAPI schemas, `event-types.yaml` and `contracts/fixtures/README.md`).

## Plan and who owns what

The plan lives in GitHub issues, not in chat or in either Claude's memory. Both Claude Code sessions read it the same way.

- Every task is an issue with one zone label (`agent`, `platform`, `contract`, `repo`) and an assignee. The assignee is the only one who works on it; nobody starts an issue assigned to the other person.
- A question for the other side is an issue labelled `question` (or `contract` if the answer changes the contract), assigned to whoever must answer. Do not guess the answer in code; continue with what the contract already says.
- Every PR names its issue (`Closes #N`). Work without an issue gets an issue first.
- At the start of a session, Claude runs `gh issue list --assignee @me --state open` and `gh issue list --label contract --state open`, and picks work only from there.
- When a decision is made, it goes into the issue or an ADR, never only into a chat.

## Contract

| Part | File | What it fixes |
| --- | --- | --- |
| Event ingest | `openapi/iomp-v1.yaml` | Envelope `schema_version`, `source_id`, `events[]`; dedup by `source_id` + `source_event_id`; `Idempotency-Key`; limits (500 events, 5 MiB per batch, 256 KiB per event); 202 with per-item receipts; RFC 9457 errors |
| Inventory and topology | `openapi/iomp-v1.yaml` | `GET/POST /api/v1/cis`, `PATCH /api/v1/cis/{id}` with ETag, `POST/PATCH /api/v1/topology/relationships`; which fields the agent may write; new edges are Proposed |
| Metrics, logs, traces | `otlp-profile.yaml` | OTLP/HTTP Protobuf, base URL, `/v1/metrics`, `/v1/logs`, `/v1/traces`, auth |
| Event types | `event-types.yaml` | Every agent `event_type` and `condition_id`, including `agent.heartbeat` and `health_check.failed` |
| Golden data | `fixtures/` | Agent requests and platform responses: full 202, partial 202, 409, 413, 422, 429 |

The agent integration gaps from agent spec 8.6 (GAP-AG-001..008: authentication, partial 202 and retry classes, CI lookup and ETag, OTLP routes, heartbeat, fingerprint, default edge status, no fleet-management API) are answered in `docs/adr/ADR-CT-001-agent-integration-gaps.md` (Accepted). New questions are issues labelled `contract`.

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
