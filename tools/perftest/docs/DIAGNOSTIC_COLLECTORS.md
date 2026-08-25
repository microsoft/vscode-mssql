# Diagnostic collectors

The collector framework (design §14) lets diagnostic depth scale without ever
touching official numbers: collectors observe the rep lifecycle
(`validate → preLaunch → postLaunch → onProcessDiscovered →
onScenarioStart/End → preShutdown → postExit → normalize → teardown`), every
hook is fault-isolated (a throwing collector logs a warning and degrades), and
every collector metric is forced `official: false` by the normalizer —
structurally, not by convention.

Implementations: `packages/perftest-cli/src/collectors/`. Enablement is
per-config under `diagnostics`; pass-type and platform gating are declared on
each collector and enforced by the pipeline.

| Collector            | Pass                     | What it produces                                                                                                                                                                                         | Requires                                                                                                                                 |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `processSampler`     | measurement + diagnostic | `process-samples.jsonl`; `process.peakWorkingSet` / `process.cpuTime` per process, plus provider-fair `process.dataPlane.peakWorkingSet` / `process.dataPlane.cpuTime` totals across extensionHost + sts | nothing (PowerShell CIM / ps)                                                                                                            |
| `stsEnvelopeJournal` | diagnostic               | sts2 journal copies under `artifacts/sts2/`; `sts.rpc.<method>.duration` medians; `sts2.query.pipeline.*` stage, byte, and allocation aggregates                                                         | local STS build + `STS_ENABLE_STS2=1` (see STS_INSTRUMENTATION.md)                                                                       |
| `cdpExtHostProfile`  | diagnostic               | `artifacts/exthost.cpuprofile` (V8 sampling profile of the scenario window; open in VS Code/speedscope)                                                                                                  | none — adds `--inspect-extensions=<port>` and drives the Node inspector protocol                                                         |
| `cdpRendererTrace`   | diagnostic               | `artifacts/renderer.trace.json`; workbench renderer paint/layout/script totals                                                                                                                           | none — adds/reuses `--remote-debugging-port=<port>` and uses the workbench target's Chromium Tracing domain                              |
| `cdpRendererProfile` | diagnostic               | `artifacts/query-studio-webview.cpuprofile`; Query Studio webview sampled CPU/duration                                                                                                                   | none — reuses the debugging port, probes only MSSQL-owned iframe targets for the product DOM sentinel, and drives the V8 Profiler domain |
| `dotnetTrace`        | diagnostic               | `artifacts/sts.nettrace` (bounded STS EventPipe trace; CPU, `gc-verbose`, or `gc-collect`)                                                                                                               | `dotnet tool install -g dotnet-trace`                                                                                                    |
| `wprEtw`             | diagnostic               | `artifacts/trace.etl` (system ETW, GeneralProfile, scenario window)                                                                                                                                      | Windows Performance Toolkit + elevated session; warns + skips otherwise, and `wpr -cancel` on teardown guarantees no session leaks       |

Planned next (§14.3): `otelMinimal` (OTLP receiver) and the remaining collector
hardening/calibration work. Renderer tracing and Query Studio target profiling
are diagnostic-only; neither contributes official regression numbers.

Scenario-window collectors use an explicit two-phase driver handshake. They
are fully armed before `scenario.start` is timestamped, keeping attach cost out
of the measured interval, and they flush at `scenario.end` before success
checks or editor cleanup can remove the webview target. A 60-second bounded
driver wait fails the scenario instead of silently accepting a partial capture.

`dotnetTraceProfile` selects the EventPipe profile and
`dotnetTraceDurationSeconds` bounds collection from STS discovery (15 seconds
by default). The scenario-end barrier keeps STS alive until the duration
expires, allowing `dotnet-trace` to collect managed runtime rundown and produce
symbolized allocation stacks. This is intentionally diagnostic-only: the
bounded wait is outside the measured scenario interval but can lengthen a rep.
The tool is launched directly with an argument vector (`shell: false`).

## Calibration entries (§12.3)

```jsonc
{
    "collector": "processSampler",
    "scenarioId": "query-10k-results",
    "samples": 5, // per side, warmups dropped, quiet machine
    "overheadPctP50": 1.96, // 1061.6ms on vs 1041.2ms off (median)
    "approvedForMeasurement": true, // cost "low"; delta within run-order noise at n=5
    "approvedBy": "perftest build (autonomous, recorded in PROGRESS.md Entry 11)",
    "date": "2026-07-01",
    "notes": "persistent-worker sampler @2Hz; first attempt on a busy box was inconclusive and was NOT used",
}
```

An earlier 3-rep attempt on a busy interactive box was inconclusive (CV over
threshold, operator-contaminated) and was discarded rather than interpreted —
the §12.3 rule (uncalibrated ⇒ diagnostic-only) applied until this entry.

## Rules recap

- Measurement passes may run only `low`-cost, measurement-approved collectors
  (today: markers + processSampler). Everything else is diagnostic-only until
  a §12.3 overhead calibration says otherwise.
- A missing tool is a **validation warning** on the rep
  (`collector:dotnetTrace:dotnetTraceAvailable = warning`), never a failure
  and never a corrupted metric.
- Collector artifacts land under the rep's `artifacts/` dir with retention
  classes (`always` / `on-regression` / `on-failure`) honored by
  `perftest cleanup`.

## The full-diag config

`examples/config.fulldiag.local.jsonc` runs `query-10k-results` once with
every implemented collector enabled — the one-command "give me everything"
investigation pass. Its rep directory contains markers, process samples, the
ext-host and Query Studio webview CPU profiles, the workbench renderer trace,
the STS EventPipe trace, the sts2 envelope journal, and (when elevated) the
system ETL, all linked from report.html.
