# STS instrumentation (sts2-aligned)

How the harness gets SQL Tools Service–side diagnostics, and why it builds on
the **sts2 refactor's observability core** instead of the design doc's
original §18 ActivitySource plan.

## The decision (plan amendment vs design §18)

Design §18 proposed adding OpenTelemetry ActivitySources, a StreamJsonRpc
trace strategy, and W3C traceparent propagation inside STS. Exploration of
the sts2 refactor (branch work in `sqltoolsservice`, docs in `docs/sts2/` and
`refactor_docs/`) showed it already ships something strictly stronger for
diagnosis:

- **Journaled envelope log**: every RPC frame, effect, config change, and
  diagnostic becomes one `Sts2Envelope` (gapless `seq`, `ts`, `corr`
  correlation id, `cause` back-pointer, canonical digest) in append-only
  JSONL segments — byte-identical replayable (`tools/sts2-replay`).
- **`IEnvelopeSink`** — a public, fault-isolated fan-out seam for live
  observers (`Sts2SessionOptions.EnvelopeSinks`, `BroadcastEnvelopeSink`).
- **EventSource `Microsoft-SqlTools-Sts2`** with counters
  (envelopes-total, rpc-errors-total, sink-faults-total) consumable by
  `dotnet-counters`.
- **`v2/diagnostics.*` RPCs** (`ping`, `health`, `state`, `exportLog`,
  `setCapture`) with runtime health overlays (queue depth, open leases,
  active query pumps, per-code error histograms).

It has **no** W3C traceparent or OTLP — correlation is `corr`/`cause`. Rather
than bolt a parallel tracing story onto STS, the harness consumes the journal
directly; an envelope→OTel adapter sink remains the natural future extension
point if OTLP export is ever wanted (design seam preserved).

Everything is gated by `STS_ENABLE_STS2=1` (or `--enable-sts2`) with zero
footprint when off — which composes perfectly with the harness's own
`PERF_MODE` gating.

## What the harness does

### 1. STS process self-report (the only STS code change)

`src/Microsoft.SqlTools.ServiceLayer/Utility/PerfSelfReport.cs` (+ one call
in `Program.cs`): when `PERF_MODE=1` and `PERF_MARKER_URL` are present, STS
fire-and-forgets a single `sts.process.ready` marker (pid, assembly version,
runtime, arch, sts2Enabled) to the localhost sink. No perf mode ⇒ no-op; all
failures swallowed; nothing touches stdout (the RPC channel).

### 2. `stsEnvelopeJournal` collector (diagnostic pass only)

`packages/perftest-cli/src/collectors/stsEnvelopeJournal.ts`:

- Config (`examples/config.stsdiag.local.jsonc`) launches VS Code with
  `MSSQL_SQLTOOLSSERVICE` pointing at a locally built STS and
  `STS_ENABLE_STS2=1` — env flows orchestrator → VS Code → extension host →
  the spawned STS child.
- After the rep exits, journal directories (`**/sts2/<runId>/`, under the
  rep's user-data where the extension points STS logs) are copied to
  `artifacts/sts2/` and parsed.
- `rpc.in.request` envelopes are matched to `rpc.out.result`/`rpc.out.error`
  by `corr`; per-method median handler latencies are emitted as
  `sts.rpc.<method>.duration` metrics — always `official: false` (collector
  metrics are structurally incapable of being official).
- Journaled `sts2.query.stats` diagnostics are flattened into
  `sts2.query.pipeline.*` metrics. Additive fields sum across queries/batches;
  `maxEventPayloadBytes` keeps its maximum. The metrics cover driver-read and
  credit time, row serialization, UTF-8 measurement, null bitmap/page/event
  construction, coordinator posting, exact payload bytes, cell/null counts,
  and synchronous managed allocation deltas. Opaque query/connection ids,
  status, SQL, and cell values are never promoted to metric tags.

### Local STS build

```powershell
dotnet build src/Microsoft.SqlTools.ServiceLayer -c Debug
dotnet build src/Microsoft.SqlTools.ResourceProvider -c Debug
# copy SqlToolsResourceProviderService.exe + missing deps into the ServiceLayer bin
```

The extension's env override requires ONE folder containing both
`MicrosoftSqlToolsServiceLayer` and `SqlToolsResourceProviderService`
executables.

## Deferred (seams preserved)

- Envelope→OTel adapter sink (`IEnvelopeSink` impl) and OTLP export.
- `dotnet-counters` live attach on the `Microsoft-SqlTools-Sts2` EventSource
  (M5; needs a graceful-stop story on Windows).
- `v2/diagnostics.health` polling around scenario windows.
- W3C traceparent injection over JSON-RPC (`PERF_TRACEPARENT` is already in
  every rep's env, unused server-side by design for now).
