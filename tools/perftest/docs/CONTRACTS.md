# Contracts

The contracts are the stable spine of the whole system: every producer (driver
extension, product extension, STS, collectors) and every consumer (normalizer,
store, regression engine, reports, future central infra) meets at these shapes.
They live in `packages/perf-contracts` and were **copied verbatim** from the
design (`perftest-docs/mssql-vscode-perf-system-v2`); the JSON files are the
single source of truth and the TypeScript types mirror them.

```text
packages/perf-contracts/
  schemas/marker.schema.json        Marker contract (design §10)
  schemas/perf-config.schema.json   Run configuration (design §25)
  schemas/perf-result.schema.json   Per-repetition result (design §20)
  sql/perf-store.schema.sql         SQLite store schema (design §23)
  fixtures/                         Design-provided examples; MUST always validate
  src/marker.ts                     TS mirror + well-known marker names
  src/result.ts                     TS mirror of the result contract
  src/config.ts                     TS mirror of the config contract
  src/controlMessages.ts            Control-plane protocol + scenario model (§9/§7)
  src/ids.ts                        Run/trace identity + time helpers (§11)
  src/validation.ts                 ajv (draft 2020-12) runtime validators
```

## Marker (`marker.schema.json`)

A marker is one append-only semantic event. Markers are the **only** source of
official metrics.

Key rules (enforced by the harness, not just convention):

- `scenario.start` and `scenario.end` are required for every valid rep; a rep
  missing either is `invalid` and never feeds regression.
- `timestampUnixNs` is epoch nanoseconds **as a decimal string** (JSON numbers
  lose precision at ns scale). Used only for cross-process ordering.
- `monotonicNs` is process-local monotonic time; exact durations are computed
  within one process's monotonic plane, never across processes.
- `phase`: `instant` | `begin` | `end` (paired by `name` + `correlationId`) |
  `counter` (value in `attrs.value`).
- Marker writes must never block the product: producers use a bounded queue
  with best-effort flush.
- `process.role` uses the §15 role vocabulary (`extensionHost`, `webview`,
  `sts`, ... ) — see `ProcessRole` in `src/marker.ts`.

## Result (`perf-result.schema.json`)

One `result.json` per repetition, with one unified `metrics` array.

- Every metric declares `name`, `value`, `unit`, `component`, `processRole`,
  `source`, `official`, `lowerIsBetter`.
- `official: true` is only legal for marker/product-timer sources in a
  measurement pass on a `passed` rep (§12.2) — the normalizer enforces this.
- Derived metrics (e.g. `sql.networkDriver.duration`) must carry a
  `derivation` block (formula, inputs, confidence) — provenance is mandatory.
- `status`: `passed` | `failed` (ran, but success proof failed — timing exists
  but is not regression-eligible) | `invalid` (cannot be trusted at all) |
  `aborted`.
- `environment.environmentHash` is required; official metrics are never
  compared across different hashes unless explicitly configured.

## Config (`perf-config.schema.json`)

Loaded from JSONC (comments allowed), schema-validated before anything runs.
`runId: "auto"` resolves to a fresh sortable id
(`2026-06-29T22-00-00Z_ab12cd34`). The raw config text is hashed
(`configHash`) and snapshotted into the run directory for reproducibility.

Notable fields: `passType` (measurement/diagnostic/calibration),
`repetitions`/`warmupRepetitions`, `vscode.extensions` (vsix or development
path), `sql.provider` (`dockerCompose` | `testcontainers` | `external`),
`environment.requireIdle`, per-collector toggles under `diagnostics`,
`regression.thresholds` (percent + absolute floor + optional Welch t).

## Control messages (`src/controlMessages.ts`, design §9)

WebSocket JSON messages between orchestrator and the driver extension. Every
message carries the same envelope: `schemaVersion`, `kind`, `runId`, `repId`,
`scenarioId`, `timestampUnixNs`, `sender {role,pid,name}`.

Kinds: `hello` → `ready` (driver handshake; hello carries the auth token),
`startScenario` (orchestrator ships the full `ScenarioSpec`),
`scenarioStarted`, `marker`, `processDiscovered`, `scenarioCompleted`,
`scenarioFailed`, `artifactHint`, `shutdown`, `heartbeat`, plus
`calibrationPing`/`calibrationPong` implementing the §11.3 clock offset
estimation (`offset = ((t0 + t3) / 2) - e2`).

The **scenario model** (§7) also lives here: `ScenarioSpec` with
`setup`/`measure`/`success`/`cleanup`, step types (`command`, `openDocument`,
`waitForMarker`, `waitForCommandCompletion`, `webviewProbe`,
`objectExplorerProbe`), and success criteria (`markerSeen`, `webviewProbe`,
`noErrors`). `sleep` is deliberately not a step type.

## Identity & time (`src/ids.ts`, design §11)

- `newRunId()` — human-sortable, globally unique.
- `newTraceId()`/`newSpanId()`/`traceparent()` — W3C shapes; one traceId per rep.
- `nowUnixNs()` — epoch-ns decimal string (ms precision scaled; the ordering
  plane, not the duration plane).
- `nowMonotonicNs()` — `process.hrtime.bigint()`, the duration plane.

## SQLite store (`sql/perf-store.schema.sql`, design §23)

Tables: `runs`, `run_repositories`, `environments`, `scenarios`,
`repetitions`, `metrics`, `artifacts`, `validations`, `baselines`,
`comparisons`, `comparison_metrics`, plus the `official_metric_samples` view
which pre-filters to `official = 1 AND pass_type = 'measurement' AND
rep.status = 'passed'` — regression reads **only** from this view, making the
official-metric rules structural rather than procedural.

## Validation

`validateMarker` / `validateConfig` / `validateResult` (ajv, draft 2020-12,
`allErrors`) return `{ valid, errors[] }`. The design-provided fixtures are
unit-tested to validate on every run (`npm test` in `perf-contracts`) — if a
schema edit ever breaks a fixture, the build fails, which is exactly the point.
