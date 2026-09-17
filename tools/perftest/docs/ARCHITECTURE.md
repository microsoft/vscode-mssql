# Architecture — the end-to-end loop

How one repetition actually executes, component by component. This is the
"seed crystal" from design §32 Milestone 1: everything else in the system
(product instrumentation, SQL scenarios, collectors, regression) grows around
this loop without changing its shape.

## Components

```text
┌──────────────────────────────────────────────────────────────────────┐
│ perftest CLI (orchestrator, one process per run)                     │
│                                                                      │
│  loadConfig ─► preflight ─► per rep:                                 │
│    ┌────────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│    │ ControlServer   │   │ MarkerSink   │   │ VS Code launcher     │ │
│    │ ws /control     │◄──┤ markers.jsonl│   │ resolve + spawn      │ │
│    │ http /v1/markers│   │ (validated)  │   │ fresh dirs, PERF_* env│ │
│    └───────▲────────┘   └──────▲───────┘   └──────────┬───────────┘ │
│            │                    │                      │ spawn       │
│  normalizer ─► result.json ─► SQLite ─► report.md      │             │
└────────────┼────────────────────┼──────────────────────┼─────────────┘
             │ ws (token)         │ http (token)         ▼
      ┌──────┴──────────────────────────────────────────────────┐
      │ VS Code Desktop (unforked, --extensionDevelopmentPath)  │
      │   extension host                                        │
      │     mssql-perf-driver ── hello/ready/markers/scenario   │
      │     vscode-mssql (M2+) ── product markers ──► http sink │
      │   renderer/webviews (M4′) ── marks via postMessage      │
      └──────────────────────────────────────────────────────────┘
```

- **ControlServer** (`src/control/controlServer.ts`) — one per rep. Binds a
  random port on 127.0.0.1. Hosts the WebSocket control channel (driver) and
  `POST /v1/markers` (any perf-mode process, Bearer token). Relays non-driver
  markers to the driver so `waitForMarker` steps can resolve on product/STS
  markers.
- **MarkerSink** (`src/markers/markerSink.ts`) — schema-validates every
  marker, appends `markers.jsonl`, tracks `scenario.start`/`scenario.end`
  bookkeeping, exposes `waitForMarker` to the orchestrator side.
- **Launcher** (`src/launch/*`) — `@vscode/test-electron` downloads/caches the
  pinned build (version + quality recorded from the build's `product.json`);
  the orchestrator then **spawns the executable directly** so it owns PID,
  stdio (captured to files), env, and shutdown. Fresh `--user-data-dir` and
  `--extensions-dir` per rep (profile modes per §13.2). Extensions load via
  `--extensionDevelopmentPath` (config source `developmentPath`).
- **mssql-perf-driver** (`extensions/mssql-perf-driver`) — dependency-free
  extension using the extension host's global WebSocket. With `PERF_MODE`
  unset, `activate()` returns immediately — the whole non-perf path is one
  `if`. In perf mode: connect → `hello` (token) → env checks → `ready` →
  execute `startScenario` specs with the step engine → emit markers →
  `scenarioCompleted`/`scenarioFailed` → quit on `shutdown`.
- **Normalizer** (`src/normalize/normalizer.ts`) — markers + outcome →
  schema-valid `result.json`. Enforces the honesty rules (see below).
- **Store/Report** — SQLite rows per §23; Markdown report per run.

## Rep lifecycle (design §9.2)

1. Orchestrator creates the rep directory tree and starts MarkerSink + ControlServer.
2. Spawns VS Code with `PERF_MODE=1`, `PERF_RUN_ID/REP_ID/SCENARIO_ID`,
   `PERF_CONTROL_URL/TOKEN`, `PERF_MARKER_URL`, `PERF_ARTIFACT_DIR`,
   `PERF_TRACEPARENT`.
3. Driver activates, connects, sends `hello` (with token + extension host PID).
4. Orchestrator runs **clock calibration** (§11.3): 5 ping/pongs; the
   minimum-round-trip sample gives the offset estimate; stored in
   `result.json.validations`.
5. Driver sends `ready` after local environment checks.
6. Orchestrator sends `startScenario` with the full `ScenarioSpec`, a fresh
   `traceId`, and the artifact dir.
7. Driver: setup steps → `scenario.start` marker → action steps → end
   condition (`afterLastAction` or `waitForMarker`) → `scenario.end` marker →
   success criteria → `scenarioCompleted` | `scenarioFailed`.
8. Orchestrator sends `shutdown`; driver executes `workbench.action.quit`;
   after a 20 s grace the process tree is force-killed (recorded in the log —
   a clean run never needs it).
9. ControlServer and MarkerSink close; normalizer writes `result.json`;
   store rows inserted; next rep.

If VS Code exits early at any point, the pipeline races the exit against the
pending wait and fails the rep with the exit code in the error.

## Failure policy (design §9.3)

| Failure                                                | Rep status                               |
| ------------------------------------------------------ | ---------------------------------------- |
| Driver never connects / handshake breaks               | `invalid` (+ run aborts: infrastructure) |
| Scenario timeout / step failure                        | `failed`                                 |
| `scenarioCompleted` but a success criterion failed     | `failed`                                 |
| `scenarioCompleted` but `scenario.start`/`end` missing | `invalid`                                |
| All good                                               | `passed`                                 |

## Timing honesty (design §11, §12)

- `scenario.wallclock` = `end.monotonicNs − start.monotonicNs` when both
  markers come from the same process (the normal case — the driver emits
  both); the epoch-plane fallback is tagged `timePlane: "epoch"` so it is
  always distinguishable.
- The metric exists **only** when both markers were actually observed. No
  marker ⇒ no metric ⇒ `invalid` rep. There is deliberately no code path that
  synthesizes a duration from anything else.
- `official: true` only when `passType == "measurement"` **and** the rep
  passed. The SQLite view `official_metric_samples` re-enforces the same rule
  structurally at query time.

## Output layout (design §22)

```text
perf-runs/<runId>/
  run-config.snapshot.jsonc   exact config text as loaded
  environment.json            fingerprint + environmentHash
  summary.json                per-scenario per-rep status + wallclock
  report.md                   human report
  harness-log.jsonl           complete harness telemetry (all levels)
  scenarios/<scenarioId>/reps/rep-NN/
    result.json               the §20 contract, schema-validated
    markers.jsonl             every accepted marker
    vscode-user-data/         fresh profile (per profile mode)
    vscode-extensions/        fresh extensions dir
    artifacts/
      vscode-stdout.log / vscode-stderr.log
      vscode-crashes/
```
