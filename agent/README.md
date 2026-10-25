# IOMP Agent

Collects metrics, logs, events, traces and inventory from Linux and Windows hosts, keeps them in a durable local spool and delivers them to IOMP through the existing platform APIs. Spec: `docs/specs/telemetry-agent-technical-specification.md`.

Stack: C# on .NET 10 with a SQLite spool, see `docs/adr/ADR-AG-001-stack.md`. Build and test commands are in `agent/CLAUDE.md`.
