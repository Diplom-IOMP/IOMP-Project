# Contract changelog

Newest first. Add lines at the top; never edit old entries.

- v0 fixture semantics (no schema change): `fixtures/README.md` defines `preconditions`, `server_time`, fixture independence and how server-generated values are compared. Every ingest fixture has its own `Idempotency-Key` except `409-idempotency-conflict`, which reuses the key of its precondition `202-full`. `202-partial` now has `202-full` as a precondition: item 0 is new, item 1 is the duplicate of `202-full`'s event with its original `event_id`.
- v0 accepted by both owners: ADR-CT-001 status Accepted. From here on, v1 changes are additive only.
- v0 (agent part): `event-types.yaml` registers `agent.heartbeat`, `health_check.failed`, `metric_threshold.exceeded`, `inventory.changed`; new fixtures `202-condition-cleared` (recovery paired with `202-full`, proves one alert cycle for GAP-AG-006), `202-heartbeat`, `202-inventory-changed`.
- v0 (platform part): `openapi/iomp-v1.yaml` with `events:ingest`, CIs and topology relationships; `otlp-profile.yaml`; ingest fixtures (202 full/partial, 409, 413, 422, 429); answers to GAP-AG-001..008 in ADR-CT-001. `event-types.yaml` follows from the agent owner.
- Contract directory created. No schemas yet.
