# ADR-AG-001: Agent stack

- Status: Proposed
- Deciders: @Rewer2022 (agent)
- Date: 2026-10-25
- Issue: #16

## Context

Agent spec 6.1 leaves language, runtime and storage engine to an ADR and names the criteria: memory/CPU, Linux and Windows support, crash semantics, the local WEB, and packaging. The hard limits that drive the choice:

- Resources (AG-NFR-PERF-002): Node avg CPU <= 0.20 vCPU, p95 <= 0.5, RSS <= 384 MiB; Gateway avg <= 1 vCPU, RSS <= 1 GiB; leak after warmup <= 5% per 24 h.
- One codebase for Linux and Windows services, including the Windows Event Log reader and service control.
- Durable spool (AG-FR-BUFFER-001, AG-FR-CORE-003): atomic record + cursor commit, fsync before a local receiver acknowledges, WAL recovery, single writer lock, N and N-1 read the same schema.
- OTLP in and out (OTLP/HTTP Protobuf to IOMP per `contracts/otlp-profile.yaml`, local OTLP receiver on 4318), Prometheus scrape.
- Local WEB/API (`agent/api/agent-api-v1.yaml`) with TLS, RBAC, CSRF.
- Signed packages, separate privileged update helper, reproducible builds (AG-NFR-MAINT-001).
- Reusing OpenTelemetry components is allowed, but their in-memory queues do not replace the spool.

The agent owner works in C#, so the choice is made within .NET.

## Decision

| Concern | Choice |
| --- | --- |
| Runtime | .NET 10 (LTS), C#. SDK pinned in `agent/global.json`. .NET 8 is not used: its support ends in November 2026 |
| Host | Worker Service (`Microsoft.Extensions.Hosting`) with `UseWindowsService()` and `UseSystemd()`; one supervisor process owns the spool |
| Build | `dotnet publish` self-contained, single-file, per RID (`linux-x64`, `linux-arm64`, `win-x64`), trimmed; the update helper is a separate small executable |
| Memory | Workstation GC, concurrent off for Node; `GCHeapHardLimit` set from the profile (Node 256 MiB, Gateway 768 MiB) to stay under the RSS limits; bounded `Channel<T>` and pooled buffers before allocation |
| Spool | SQLite via `Microsoft.Data.Sqlite` (bundled native library), `journal_mode=WAL`, `synchronous=FULL`, one writer connection guarded by an exclusive lock file. Record, capture cursor and inflight manifest are written in one transaction. `PRAGMA user_version` holds the schema version; migrations are additive so N-1 can read N |
| OTLP | `OpenTelemetry.Proto`-generated types (`Google.Protobuf`) for encoding and the local receiver; the exporter is plain `HttpClient`, so retry and receipt handling stay in our delivery workers instead of the OpenTelemetry .NET exporter queue |
| Prometheus | Own text/OpenMetrics parser with fixture tests (AG-TEST-010); no mature .NET parser exists |
| REST client | Generated from `contracts/openapi/iomp-v1.yaml` with NSwag into `agent/src/IompAgent.IompApi`; never hand-written DTOs |
| Local WEB/API | ASP.NET Core Minimal API on Kestrel with TLS, contract `agent/api/agent-api-v1.yaml`; UI is Blazor WebAssembly served as static files by the same host |
| Windows | `System.Diagnostics.Eventing.Reader` for Event Log, `System.ServiceProcess` for service control, DPAPI (`ProtectedData`) for secrets |
| Linux | systemd unit, `/proc` and `/sys` readers, secrets in a root-only keystore file |
| Tests | xUnit; contract tests run the generated client against `agent/test/MockIomp`, which serves `contracts/fixtures/`; crash tests use failpoints around write/fsync/commit/send/receipt |
| Lint | `dotnet format --verify-no-changes`, nullable reference types and warnings as errors |
| Packaging | `.msi` via WiX, `.deb`/`.rpm` via nFPM; signatures checked by the update helper (AG-FR-LIFE-001) |

Exact package versions are pinned in `Directory.Packages.props` (central package management) in the first code PR, not here.

## Alternatives

- Go + bbolt. Smallest static binaries and the OpenTelemetry Collector ecosystem, but not the owner's language; the team would pay for it in speed and review quality.
- .NET Native AOT. Lower startup and RSS, but ASP.NET Core and Blazor hosting, reflection-based serializers and the generated client need extra work under AOT. Kept as an option once AG-TEST-040 measures the JIT build.
- OpenTelemetry Collector distribution with custom components. Its queue lacks our record + cursor transaction and receipt ledger, and the control plane would still be custom.
- LiteDB or a custom append-only log for the spool. SQLite has better-known crash semantics and tooling; the spool sits behind an interface, so the engine can still be swapped after benchmarks.

## Consequences

- One solution under `agent/` builds every artifact; CI can publish Windows binaries on Linux, but Windows-only collectors are tested on a Windows runner.
- The GC heap limit is part of the profile config; AG-TEST-040 must confirm Node RSS <= 384 MiB with the full collector mix before release.
- SQLite WAL with `synchronous=FULL` bounds throughput by fsync per commit, so the receiver batches records per transaction; the Gateway sizing in spec 5.2 must be confirmed by benchmark.
- The platform side uses Next.js; nothing is shared between them except `contracts/`.
