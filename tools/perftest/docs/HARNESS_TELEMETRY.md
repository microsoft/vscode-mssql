# Harness self-telemetry

The harness holds itself to the same observability bar it demands of the
product: every component emits structured events through a shared logging
core, so any run — and any harness bug — can be traced end-to-end after the
fact. This is the instrumentation of the _harness itself_; product/scenario
measurement uses markers (see CONTRACTS.md).

Implementation: `packages/perftest-cli/src/telemetry/logger.ts`.

## Model

- **`HarnessLogger`** — component-scoped. Loggers nest with dots:
  `perftest.run.controlServer`, `perftest.run.launcher`, ... Create children
  with `logger.child("controlServer")`.
- **Events** — `logger.info(event, message?, fields?)` (and
  `trace/debug/warn/error`). An event is a stable machine-readable name
  (`launch.spawned`, `marker.received`); the message is for humans; `fields`
  carry structured data.
- **Spans** — `logger.span("launch")` logs `launch.begin` immediately and
  `launch.end` (with `durationMs` and a stable `spanId`) on `span.end()`;
  `span.fail(err)` logs `launch.failed` with the error. Child work joins the
  trace via `logger.child("sub", span.spanId)` → events carry
  `parentSpanId`, so a run's harness log reconstructs into a tree.

## Event shape (JSONL)

```json
{
    "timestampUnixNs": "1782770400123456789",
    "level": "info",
    "component": "perftest.run.launcher",
    "event": "launch.end",
    "spanId": "9f86d081884c7d65",
    "parentSpanId": "a1b2c3d4e5f60718",
    "durationMs": 812.4,
    "fields": { "pid": 31424 }
}
```

## Sinks

| Sink            | Destination                           | Level                                 | Purpose                            |
| --------------- | ------------------------------------- | ------------------------------------- | ---------------------------------- |
| `ConsoleSink`   | stdout/stderr (pretty one-liners)     | `PERFTEST_LOG_LEVEL` (default `info`) | Live operator view                 |
| `JsonlFileSink` | `perf-runs/<runId>/harness-log.jsonl` | everything (`trace`+)                 | Complete post-hoc trace of the run |
| `MemorySink`    | in-process array                      | everything                            | Tests                              |

Sinks are composed with `CompositeSink`; a throwing sink is isolated and can
never take down the harness (mirroring the sts2 sink fault-isolation rule).

## Conventions

- Event names: `<noun>.<verb>` or `<area>.<noun>.<verb>` in lowerCamel, e.g.
  `store.insertMetrics`, `controlServer.clientAuthenticated`,
  `scenario.markerTimeout`.
- Spans wrap every lifecycle phase: config load, preflight, SQL provision,
  VS Code launch, scenario execution, rep normalization, store writes, report
  generation. Rule of thumb: if a phase can be slow or can fail, it is a span.
- `error` events always include the failure that a human would need first;
  stack traces go in the message, structured context in `fields`.
- Never log secrets: connection strings, tokens, SQL text are redacted before
  logging (design §29 applies to the harness's own logs too).

## Reading a run's harness log

```powershell
# Everything the control server did, in order
Get-Content perf-runs/<runId>/harness-log.jsonl |
  ConvertFrom-Json | Where-Object component -like "*controlServer*" |
  Format-Table timestampUnixNs, event, durationMs, fields

# All spans over 500 ms
Get-Content perf-runs/<runId>/harness-log.jsonl |
  ConvertFrom-Json | Where-Object durationMs -gt 500
```
