# Contracts

The single source of truth for everything the agent and the platform exchange. The platform must accept what is described here; the agent must send only what is described here.

| File | Content | Approval needed from |
| --- | --- | --- |
| `openapi/iomp-v1.yaml` | Platform public API used by the agent: `POST /api/v1/events:ingest`, `GET/POST /api/v1/cis`, `PATCH /api/v1/cis/{id}`, `POST/PATCH /api/v1/topology/relationships` | @mutednew |
| `otlp-profile.yaml` | OTLP/HTTP base URL, signal paths, auth | both |
| `event-types.yaml` | Every `event_type` and `condition_id` the agent emits (affects platform fingerprints) | @Rewer2022 |
| `fixtures/` | Golden agent requests and expected platform responses (full 202, partial 202, 409, 413, 422, 429) | both |
| `CHANGELOG.md` | Contract history, newest first | both |

## Changing the contract

1. Open a PR from `contract/<topic>` that touches only `contracts/`: schema, fixtures and a `CHANGELOG.md` line.
2. The other owner reviews it.
3. After merge, each side implements its part in its own PR.
4. v1 accepts additive changes only. Breaking changes go to `/api/v2` (platform spec, ASSUMPTION-010).

Both sides test against the same fixtures: the platform checks it accepts the requests and answers as recorded; the agent checks it produces the requests and parses the responses.
