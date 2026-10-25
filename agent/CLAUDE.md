# IOMP Agent

Zone: `agent/`, `docs/agent/`, `docs/adr/ADR-AG-*`, `.github/workflows/agent.yml`. Everything else is read-only.
Spec: `docs/specs/telemetry-agent-technical-specification.md` (IDs `AG-FR-*`, `AG-NFR-*`, `AG-TEST-*`). Section 8 (platform compatibility) is normative.

- Talk to IOMP only through `contracts/openapi/iomp-v1.yaml` and `contracts/otlp-profile.yaml`. If it is not in the contract, it does not exist (see open gaps `GAP-AG-001..008`, spec 8.6). Never add `/api/v1/agents/*`, `/api/v1/metrics` or other invented routes.
- Integration tests run against `agent/test/mock-iomp`, which serves `contracts/fixtures/`. Never depend on code in `platform/`.
- A new `event_type` or `condition_id` needs a `contract/` PR to `contracts/event-types.yaml` first. Opening and recovery of one condition keep the same `event_type` and `condition_id`.
- Local management API: `agent/api/agent-api-v1.yaml`, changed together with the code.
- Build and test commands: TODO after ADR-AG-001 (stack).
