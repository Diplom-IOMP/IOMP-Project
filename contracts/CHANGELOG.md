# Contract changelog

Newest first. Add lines at the top; never edit old entries.

- v0 (agent part): `event-types.yaml` registers `agent.heartbeat`, `health_check.failed`, `metric_threshold.exceeded`, `inventory.changed`; new fixtures `202-condition-cleared` (recovery paired with `202-full`, proves one alert cycle for GAP-AG-006), `202-heartbeat`, `202-inventory-changed`.
- v0 (platform part): `openapi/iomp-v1.yaml` with `events:ingest`, CIs and topology relationships; `otlp-profile.yaml`; ingest fixtures (202 full/partial, 409, 413, 422, 429); answers to GAP-AG-001..008 in ADR-CT-001. `event-types.yaml` follows from the agent owner.
- Contract directory created. No schemas yet.
