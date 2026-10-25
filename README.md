# IOMP

Monorepo for the Infrastructure Observability and Monitoring Platform (IOMP) and the IOMP Agent.

| Path | What | Owner |
| --- | --- | --- |
| [`platform/`](platform/) | IOMP platform: ingestion, normalization, correlation, CMDB, incidents, web UI, `/api/v1` | @mutednew |
| [`agent/`](agent/) | IOMP Agent: collectors, durable spool, delivery to IOMP, local web UI and `/agent-api/v1` | @Rewer2022 |
| [`contracts/`](contracts/) | The only interface between agent and platform: OpenAPI, OTLP profile, event types, golden fixtures | both |
| [`docs/`](docs/) | Specifications, ADRs, collaboration rules | see [`docs/collaboration.md`](docs/collaboration.md) |

Read [`docs/collaboration.md`](docs/collaboration.md) before your first change.
