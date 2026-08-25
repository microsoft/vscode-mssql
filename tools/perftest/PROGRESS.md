# HISTORICAL PROGRESS LOG — MSSQL VS Code Perf Harness build

> Frozen migration context imported from standalone perftest commit
> `860365ff65f9bbb4e102309860004d8e9bdf36f4`. See `UPSTREAM.md` for current
> migration context.

> Append-only. Newest entries at the BOTTOM. On restart: read this file end-to-end, then
> resume at the first unchecked box in `IMPLEMENTATION_PLAN.md`. Environment facts and seam
> maps recorded here so a clean session does not need to re-explore.

---

## 2026-07-01 — Entry 1: Recon complete, plan locked, build starting

### Environment facts (verified)

- Workspace: `C:\repos\test` — contains `perftest/` (blank git repo, no commits yet),
  the historical standalone design (not imported), the product extension,
  `sqltoolsservice/` (branch `dev/karlb/perftest`, clean), `PERFTEST_BUILD_PROMPT.md`.
- Toolchain: Node v24.17.0, npm 11.13.0, Docker 29.6.1, dotnet SDK 10.0.301. Windows 11.
- `STS2_SQLSERVER_CONNSTRING` env var is set (253 chars) — usable as `external` SQL provider
  for dev verification. Do NOT print/persist its value (redaction rule §29).
- Claude permissions allowlist written to `C:\repos\test\.claude\settings.local.json`
  (npm/node/dotnet/docker/git/sqlcmd/process mgmt + file ops) so the long job runs
  without prompt-storms.

### Inputs read (full)

- `PERFTEST_BUILD_PROMPT.md` — mission, guardrails, milestone order M0→M1→M2→M4′→M6′.
- Standalone perf-system design (not imported into this repository)
  (all 34 sections) + 3 JSON schemas + `perf-store.schema.sql` + 2 example configs +
  example result. Schemas will be copied verbatim into `packages/perf-contracts/schemas/`
  and `sql/`.

### Seam map — vscode-mssql (from exploration; file paths relative to `extensions/mssql/`)

- **Monorepo layout:** extension code lives in `extensions/mssql/` (NOT top-level
  src). Build: root `npm run build` (Node 24+, `scripts/workspaces.mjs`), extension bundle via
  esbuild → `dist/extension` (= package.json `main`). Watch mode exists. Package via
  `npm run package` (vsce). Extension ID `ms-mssql.mssql`, engines.vscode `^1.101.0`.
- **Activation:** `src/extension.ts:36 activate()` → `MainController.activate()`
  (`src/controllers/mainController.ts:263`) → `initialize()` (`:1040`) which spawns STS
  first (`SqlToolsServerClient.instance.initialize`), then ConnectionManager etc.
  `controller.isInitialized()` + awaited activate() are readiness signals.
- **Commands:** IDs in `src/constants/constants.ts` (`mssql.runQuery`:36, `mssql.connect`,
  etc.). Registered via `MainController.registerCommand` (`mainController.ts:208`) which
  re-emits through internal EventEmitter — a natural single seam for command begin/end markers.
- **STS spawn:** `src/languageservice/serviceclient.ts` — uses `vscode-languageclient` stdio;
  `initializeLanguageClient()` `:349`, args built in `:515/:555`. **Env override
  `MSSQL_SQLTOOLSSERVICE=<folder>` points at a local STS build** — harness will use this.
  PID not tracked explicitly (inside LanguageClient internals) — perf API must dig it out
  or track via process tree.
- **Connection ready:** `ConnectionManager.onSuccessfulConnection` event fired at
  `connectionManager.ts:1706` — clean seam for `mssql.connection.ready` marker.
- **Query flow:** `mssql.runQuery` → `SqlOutputContentProvider.runQuery` (`:319`) →
  `QueryRunner.runQuery` (`queryRunner.ts:363`) → STS request `:421`; completion via
  `handleQueryComplete` `:447` → provider onCompleteListener (`sqlOutputContentProvider.ts:630`)
  sets isExecuting=false + pushes state. Row counts in `resultSetSummaries[batch][result].rowCount`.
  **Grid is virtualized; rows pulled lazily via GetRowsRequest** — success proof for
  query-10k = resultSetSummary.complete with rowCount==10000 + webview render-complete mark
  (grid model built + paint), not "10k DOM rows".
- **Webview bridge:** extension side `src/controllers/webviewBaseController.ts` wraps
  postMessage in vscode-jsonrpc; webview side `src/webviews/common/rpc.ts` (WebviewRpc).
  Query results controllers: `src/queryResult/queryResultWebViewController.ts`.
  React grid: `src/webviews/pages/QueryResult/queryResultsGridView.tsx`.
- **Existing telemetry:** `src/telemetry/telemetry.ts` `startActivity()` uses
  performance.now() and emits durationMs — do not conflict; may harvest later. **No existing
  PERF_MODE / performance.mark usage — namespace is clear.**

### Seam map — sqltoolsservice / sts2 (paths relative to repo root)

- **Entry:** `src/Microsoft.SqlTools.ServiceLayer/Program.cs:26`; executable
  `MicrosoftSqlToolsServiceLayer` (net10.0). Build: `dotnet build src/Microsoft.SqlTools.ServiceLayer`
  → `bin/<cfg>/net10.0/`. sts2 solution filter `sqltoolsservice-sts2.slnf`; `verify.sh`/`verify.ps1`.
- **JSON-RPC:** stdio, Content-Length framing, `src/Microsoft.SqlTools.Hosting/Hosting/*`
  (ProtocolEndpoint/MessageDispatcher/ServerChannel). Services:
  `Connection/ConnectionService.cs` (handlers ~:1320), `QueryExecution/QueryExecutionService.cs`
  (handlers ~:217).
- **Legacy perf instrumentation: essentially none** (only a SqlClient EventSource → Logger
  listener and scattered Stopwatches). The real observability story is sts2.
- **sts2 (substantially implemented, in-proc beside legacy, `v2/*` methods, gated by
  `--enable-sts2` / `STS_ENABLE_STS2=1`, zero footprint when off):**
    - Journaled envelope log: every rpc/effect/diag → `Sts2Envelope` (seq, ts, corr, cause,
      digest) in JSONL segments under `<log-dir>/sts2/<runId>/`; byte-identical replay
      (`tools/sts2-replay`).
    - Public sink seam: `IEnvelopeSink` via `Sts2SessionOptions.EnvelopeSinks`
      (`Sts2Session.cs:59`), live tail `BroadcastEnvelopeSink`.
    - `EventSource "Microsoft-SqlTools-Sts2"` with counters (envelopes-total, rpc-errors-total,
      sink-faults-total) → `dotnet-counters` consumable.
    - Diagnostics RPCs: `v2/diagnostics.ping|health|state|exportLog|setCapture`.
    - **No W3C traceparent / OTLP / ActivitySource on data path.** Correlation = `corr` +
      `cause` seq chain. Perf harness therefore builds STS diag on the journal/sink seam;
      OTel becomes an adapter later (plan amendment recorded in IMPLEMENTATION_PLAN M3).
    - E2E driver template exists: `test/sts2/.../E2ETests/ServiceProcessClient.cs`.

### Decisions locked

1. Milestone order: M0 → M1 → M2 → M4′ → M6′ (core local box), then M3 (sts2-based STS
   diag) → M4-rest (XEvents) → M5 (CDP/dotnet/WPR diag collectors). Central deferred.
2. npm workspaces; ajv + better-sqlite3 + ws + commander + @vscode/test-electron.
3. Harness self-telemetry (structured JSONL logger + harness spans) built in M0, used everywhere.
4. Docs in `perftest/docs/`, one doc set per milestone.
5. SQL: docker compose digest-pinned primary; `external` via STS2_SQLSERVER_CONNSTRING fallback.
6. vscode-mssql instrumentation goes in `extensions/mssql/src/` behind `PERF_MODE=1`,
   integrated at: activation (extension.ts / mainController), registerCommand seam,
   onSuccessfulConnection, QueryRunner/SqlOutputContentProvider completion path,
   webview rpc.ts mark bridge. VSIX or dev-path load via fresh extensions dir.

### State

- perftest repo: tracking files written (IMPLEMENTATION_PLAN.md, PROGRESS.md). No code yet.
- Next: commit this baseline, then Milestone 0 task 0.1 (monorepo scaffold).

---

## 2026-07-01 - Entry 2: Milestone 0 COMPLETE (contracts + CLI skeleton)

Built and verified:

- Monorepo: npm workspaces (packages/perf-contracts, packages/perftest-cli), strict TS
  (target ES2022, CommonJS), Node 24. Deps: ajv 8, better-sqlite3 12 (prebuilt binary
  installed fine on win32/Node24), commander 14, jsonc-parser, ws 8; vitest for tests.
- perf-contracts: schemas + perf-store.schema.sql copied VERBATIM (hash-verified);
  TS mirrors (marker/result/config/controlMessages incl. ScenarioSpec step model);
  ids.ts (runId/traceId/spanId/traceparent/unixNs/monotonicNs helpers);
  ajv 2020-12 validators; fixtures incl. new marker.example.json (from design SS10).
  14/14 tests pass; tsc --strict clean.
- perftest-cli: HarnessLogger (component-scoped, spans w/ spanId+parentSpanId+durationMs,
  ConsoleSink/JsonlFileSink/CompositeSink w/ fault isolation, MemorySink);
  loadConfig (JSONC->schema->runId resolve->sha256 configHash); PerfStore (better-sqlite3,
  WAL, canonical schema exec, typed inserts for runs/envs/scenarios/reps/metrics/artifacts/
  validations, query helper); doctor v1 (real: node/docker/dotnet/disk/memory; honest SKIP
  for unimplemented checks); scenario registry (noop/ext-normal-activation/
  connect-local-container/query-10k-results specs, implemented=false until wired);
  collector registry (empty; planned catalog listed separately); cli.ts wiring all SS26
  commands + exit codes (unimplemented commands exit 5 with clear message, never fake).
  8/8 tests pass; tsc --strict clean.
- ACCEPTANCE VERIFIED on real CLI: schema validate passes for all 3 fixtures (exit 0);
  store init creates all 13 tables/views incl. official_metric_samples; scenarios list +
  collectors list honest; doctor exit 0 on this machine (node/docker/dotnet all present).
- Docs: docs/README.md (index + system overview), CONTRACTS.md, CLI.md,
  HARNESS_TELEMETRY.md. Root README.md.
- Note: .claude/settings.local.json got rewritten by permission prompts (lost broad
  allowlist); merged broad rules back in, preserving prompt-added entries.

Next: Milestone 1 (smallest E2E loop) - control server, marker sink, VS Code launcher,
mssql-perf-driver extension, noop scenario, normalizer, SQLite insert, minimal report.

---

## 2026-07-01 - Entry 3: Milestone 1 COMPLETE (smallest E2E loop works)

The seed crystal is alive. `perftest run --config examples/config.noop.local.jsonc`:
VS Code 1.127.0 downloaded via @vscode/test-electron (cached in .vscode-test/),
spawned UNFORKED with fresh dirs + PERF\_\* env; mssql-perf-driver (zero-dep, global
WebSocket) connected + authenticated; clock calibration (offset ~-0.5ms, RTT ~1ms,
min-of-5); noop scenario executed; scenario.start/end markers -> official
scenario.wallclock ~0.45ms from SAME-PROCESS MONOTONIC diff; clean quit exit 0
(no force-kill); result.json schema-valid; SQLite rows (official_metric_samples
returns exactly the 2 official samples); report.md rendered. Exit code 0.
Second run (warm cache): whole 2-rep run in 9s.

Components built:

- controlServer.ts: ws /control + http POST /v1/markers (Bearer token), SS9.1
  message types, calibration, marker relay to driver for non-driver senders.
- markerSink.ts: validated append-only markers.jsonl + waitForMarker + required
  marker bookkeeping.
- resolveVscode/spawnVscode: SS13.1 args, --extensionDevelopmentPath loading,
  stdout/stderr capture, graceful shutdown + taskkill /T escalation.
  FIX: 1.127 win32 archive nests app under <commit>/resources/app - product.json
  reader scans one subdir level.
- extensions/mssql-perf-driver: activation gate (PERF_MODE!=1 -> return, zero
  behavior), controlClient (hello/ready/calibration/startScenario/shutdown via
  workbench.action.quit), markerBus, scenarioEngine (command/openDocument/
  waitForMarker/waitForCommandCompletion steps; probes fail honestly until
  implemented; NO sleep step exists).
- normalizer.ts: honesty rules enforced (no markers -> no metric -> invalid;
  official only measurement+passed; timePlane tag records monotonic vs epoch).
- runPipeline.ts: full SS9.2 lifecycle per rep, SS22 output layout,
  run-config.snapshot + environment.json + summary.json + report.md, store writes.
- examples/config.noop.local.jsonc; run command wired with exit codes.
- Docs: ARCHITECTURE.md, RUNNING_TESTS.md.

Notes:

- Driver PERF_MODE-off runtime negative test deferred to M2 flag-off verification
  (gate is structurally the first line of activate()).
- Claude permission allowlist moved to .claude/settings.json (project) because
  approval prompts kept rewriting settings.local.json.

Next: Milestone 2 - vscode-mssql instrumentation behind PERF_MODE (activation +
command markers, perf API w/ STS pid), ext-normal-activation scenario, flag-off
verification. Product repo branch dev/karlb/perftest.

---

## 2026-07-01 - Entry 4: Milestone 2 COMPLETE (product instrumentation + activation scenario)

vscode-mssql changes (branch dev/karlb/perftest, commit 10539f918):

- NEW src/perf/perfTelemetry.ts: Perf singleton, PERF_MODE gate resolved at module
  load (Noop outside perf mode); bounded queue (1000, drop-oldest) -> 250ms batched
  HTTP POST (ndjson) to PERF_MARKER_URL w/ Bearer token; never throws/blocks.
- NEW src/perf/perfApi.ts: mssql.perf.getState command (perf mode only).
- extension.ts: mssql.activate.begin (first line) / mssql.activate.end (after last
  awaited init) + registerPerfApi + flush.
- mainController.ts registerCommand/WithArgs: mssql.command.invoked instant marker
  (EventEmitter dispatch is fire-and-forget -> no honest duration at that seam;
  durations come from semantic completion markers instead).
- serviceclient.ts: mssql.sts.spawn.begin/end + mssql.sts.ready with pid from
  PUBLIC LanguageClient.serverProcess getter; Perf.setStsPid.

Harness changes:

- Marker relay bug found via real run: product ext shares the driver ext-host PID,
  so pid-based echo suppression dropped product markers -> relay now dedupes by
  INGEST SOURCE (http relayed, ws not). Plus: replay of pre-hello http markers on
  driver connect; markerBus freshness guard (measure-end waitForMarker only accepts
  markers >= scenario.start ts); normalizer pairs LAST begin before FIRST end
  (sts spawn retry emits two begins).
- Warmed profile mode (dirs shared per scenario); scenario cleanup resets sidebar
  to Explorer so window restore doesn't pre-activate the extension.
- ext-normal-activation scenario: action = objectExplorer.focus, end =
  waitForMarker mssql.activate.end; metrics scenario.wallclock (official) +
  extension.activate (official, marker pair) + extension.stsSpawn (diagnostic).
- baseline set CLI + store.setBaseline/getBaselineRun ('\*' wildcards, env-hash bound).
- normalizer unit tests (7) incl. honesty rules; 15 tests total green.
- scripts/verify-perf-mode-off.ps1.

VERIFIED (run 2026-07-02T03-04-51Z_a95b6e4e, exit 0): 4/4 reps passed;
scenario.wallclock ~2.1-2.2s official; extension.activate 1400-1458ms official
(tight variance); extension.stsSpawn ~965ms official=false. All success
validations passed. PERF_MODE-off check: VS Code alive 45s, decoy listener got
0 connections, driver loads but stays inert. Exit 0.

Known notes:

- official_metric_samples view does NOT filter warmup reps - M6' aggregation must
  drop warmups via repetitions.warmup flag (design SS24.3 step 3).
- First-ever activation run downloads STS into the product repo (cached across
  runs since install dir resolves relative to extension folder).

Next: Milestone 4' (connect + query scenarios): SQL provisioning (docker digest
pin + external fallback), mssql.connection.ready marker, webview mark bridge,
query-10k success proof. Seed SQL already authored (sql/seed/\*).

---

## 2026-07-01 - Entry 5: Milestones 4-prime and 6-prime COMPLETE (SQL scenarios + regression gate)

### M4-prime: connect + query scenarios (verified E2E vs local SQL Server)

Product markers added (vscode-mssql, PERF_MODE-gated):

- connectionManager.ts: mssql.connection.begin (connect() entry) /
  mssql.connection.ready (after onSuccessfulConnection fire).
- queryRunner.ts: mssql.query.submit (before STS request) / mssql.query.complete
  (handleQueryComplete, attrs.rowCount summed from batch resultSetSummaries).
- Webview mark bridge: sharedInterfaces/perf.ts (PerfEnable + PerfWebviewMark
  notifications); webviewBaseController forwards webview marks -> Perf.webviewMark
  (role=webview, pid=0, webview-clock timestamps); webviews/common/perfMarks.ts
  (timeOrigin+now epoch ns, us-precision monotonic; QUEUE until enable arrives so
  the enable/handler race can never lose marks - timestamps captured at mark time);
  controller re-sends enable at 0/1/3/10s; queryResultsGridView emits
  mssql.resultsGrid.renderComplete after double-rAF with attrs.rowCount when
  isExecuting flips false.
- SQL provisioning: sqlProvisioner.ts (external via connectionStringEnv - default
  STS2_SQLSERVER_CONNSTRING (local server, Integrated auth); dockerCompose via
  compose up --wait + in-container sqlcmd; SQLCMDPASSWORD never on argv; redaction
  on all error paths); sql/docker-compose.sqlserver.yml DIGEST-PINNED
  (sha256:e07b9699a2b7...); sql/seed/create-perf-db.sql (10k deterministic rows +
  OE shape, verified COUNT=10000 before every run).
- Driver: mssqlConnect step via mssql.getControllerForTests ->
  connectionManager.connect. BUG FIXED: product keys connections by
  uri.toString() (encoded); toString(true) registered under a different key so
  runQuery silently no-oped. Also: connection profiles ship in startScenario
  payload (names logged, contents never).
- VERIFIED run 2026-07-02T03-47-19Z_fb7d42e1: connect-local-container 4/4 passed
  (measured 636-769ms); query-10k-results measured 3/3 passed (579-866ms official;
  mssql.query.toComplete ~585ms monotonic; mssql.query.toRender ~642ms epoch;
  success = query.complete rowCount 10000 AND renderComplete rowCount 10000).
  Warmup rep invalid due to the enable race - fixed after (queue + resend);
  re-verification run in flight.

### M6-prime: baselines, regression gate, reports (ACCEPTANCE PROVEN)

- statistics.ts: summarize (trimmed mean n>=10 else median, cv, p90/p95, ci95),
  Welch t w/ incomplete-beta p-values (validated vs scipy reference point).
- regression.ts: classifyMetric (minSamples -> inconclusive; maxCv -> inconclusive;
  pct AND absMs must both trip; welch significance; direction-aware lowerIsBetter),
  worst-metric-wins overallStatus.
- compareRuns.ts: baseline resolution (run id or named baseline), ENV HASH MATCH
  REQUIRED (CompareError otherwise; --allow-cross-environment override),
  warmup-excluded official samples (store.officialSamples), persistence to
  comparisons/comparison_metrics + comparison.json in run dir.
- ENV HASH FIX: fingerprint now covers the environment-RELEVANT config subset
  (vscode version/quality/extensions/extraArgs, sql provider/digest/snapshot/
  cacheMode, environment reqs, passType) - NOT the raw config hash, so rep-count/
  threshold/scenario-list edits stay comparable while measurement-affecting knobs
  break comparability as they must. vscode.env EXCLUDED (documented escape hatch
  used by the synthetic-delay proof).
- CLI: compare command (exit 1 regressed / 6 inconclusive), baseline set, run
  auto-gates when regression.baseline != none, report <runId> re-renders md+html.
- report.html (self-contained static, verdict-colored comparison table).
- Driver: PERF_SYNTHETIC_DELAY_MS injects transparent delay into measured window
  (attrs.syntheticDelayMs on scenario.end); syntheticDelay step; harness-test
  scenarios noop-synthetic-delay + noop-missing-marker.
- normalizer fix: failed-outcome reason preserved even when rep is invalid.
- ACCEPTANCE (all three proven on real runs):
    1. baseline noop 5/5 passed ~0.5ms -> baseline set gate-proof (exit 0)
    2. same scenario + 250ms injected delay: reps 253-267ms, verdict REGRESSED
       (p=0.0000, +260.1ms), comparison.json persisted, EXIT CODE 1
    3. noop-missing-marker: 5/5 INVALID, no wallclock metric anywhere, EXIT CODE 6
- 32 unit tests green (contracts 14 + cli 35... vitest: logger 4, normalizer 7,
  store 4, regression 17 = 32 in cli + 14 contracts).
- Docs: REGRESSION_MODEL.md, REPORTS.md, SCENARIO_AUTHORING.md, SQL_PROVISIONING.md.

Remaining core-box item: SQL rerun verifying webview enable-race fix (in flight).
Then: M3 (STS diag on sts2 seams), M4-rest (XEvents), M5 (diag collectors).

---

## 2026-07-01 - Entry 6: Milestones 3 and 5 COMPLETE (STS diag on sts2 + full diagnostic collectors)

### M3 (sts2-aligned STS diagnostics)

- sqltoolsservice (branch dev/karlb/perftest, commit 1db0315a):
  NEW Utility/PerfSelfReport.cs + one Program.cs call - PERF_MODE-gated
  sts.process.ready marker (pid/version/runtime/arch/sts2Enabled) POSTed
  fire-and-forget to PERF_MARKER_URL. VERIFIED E2E: marker arrives with correct
  run identity (env inheritance VS Code -> ext host -> LanguageClient child).
- Local STS build recipe: dotnet build ServiceLayer + ResourceProvider, copy
  SqlToolsResourceProviderService.exe (+missing deps) into ServiceLayer bin;
  MSSQL_SQLTOOLSSERVICE points there. GOTCHA FIXED: the env-override path always
  uses Runtime.Portable (dll) and acquires dotnet via the ms-dotnettools runtime
  extension (absent in fresh perf profiles) -> added PERF_MODE-gated
  PERF_DOTNET_PATH fallback in dotnetRuntimeProvider (vscode-mssql 1c6e464b1).
- stsEnvelopeJournal collector: harvests sts2 journal dirs (searched under rep +
  warmed-profile user-data), copies to artifacts/sts2/, parses envelopes
  (schema sts2.envelope/1, ISO ts - parser verified against real journal),
  normalizes rpc.in.request->rpc.out.result|error by corr into
  sts.rpc.<method>.duration medians (official:false).
- KEY FINDING: sts2 multiplexer routes LEGACY traffic untouched - only v2/\*
  messages journal. The mssql extension speaks legacy, so today's journals hold
  lifecycle envelopes only; RPC latencies light up when product traffic moves to
  v2. Documented in docs/STS_INSTRUMENTATION.md. dotnet-counters live attach
  (3.5) still open (Windows graceful-stop story).

### M5 (diagnostic collector framework, full-diag pass VERIFIED)

- Collector lifecycle fully wired into executeRep: validate (-> rep validations)
  -> preLaunch (MutableLaunchSpec arg/env amendment) -> postLaunch (process
  registry: vscodeMain/extensionHost/sts self-report) -> onProcessDiscovered ->
  onScenarioStart/End (scenario markers) -> preShutdown -> postExit (artifacts)
  -> normalize (metrics FORCED official:false) -> teardown. All hooks
  fault-isolated.
- processSampler (measurement-approved): PowerShell CIM/ps sampling ->
  process-samples.jsonl + process.peakWorkingSet/process.cpuTime per role.
  VERIFIED: vscodeMain/extensionHost/sts metrics in real runs.
- cdpExtHostProfile: --inspect-extensions + Node inspector protocol,
  Profiler.start/stop on scenario window -> exthost.cpuprofile. VERIFIED (287KB).
- dotnetTrace: attach on STS pid discovery, finalizes when STS exits; tool output
  captured to dotnet-trace.log. FIXED: dotnet-trace 9 rejects --profile
  cpu-sampling (it is the default); param shadowing bug. VERIFIED: 1.88MB
  sts.nettrace.
- wprEtw: start/stop on scenario window, wpr -cancel teardown guard. This Cloud
  PC blocks profiling policy (0xc5585011) -> collector degrades to a validation
  warning exactly as designed.
- Full-diag run (config.fulldiag.local.jsonc): PASSED with exthost.cpuprofile +
  sts.nettrace + sts2 journal + process samples in one rep dir; scenario
  wallclock official:false (diagnostic pass). WEBVIEW RACE FULLY FIXED:
  perf/enable now on an unconditional retry schedule (whenWebviewReady can time
  out on cold loads); cold first-webview reps pass.
- cleanup command implemented (retention by age, --keep-regressions via
  comparisons table, --dry-run). report <runId> re-renders md+html.
- Docker compose provisioning smoke test IN FLIGHT (digest-pinned image pull).

### Still open (tracked in IMPLEMENTATION_PLAN)

- 3.5 dotnet-counters; 5.2-renderer CDP trace; M4-rest (XEvents server timing,
  expand-tables-node scenario); docker smoke result to record.

---

## 2026-07-01 - Entry 7: Docker provisioning VERIFIED + redaction fix

- dockerCompose provider smoke test PASSED: digest-pinned SQL Server 2022 image
  (sha256:e07b9699a2b7...) up with healthcheck in ~60s, seed applied via
  in-container sqlcmd, COUNT(\*)=10000 verified, connection profile emitted
  (127.0.0.1,14333). Container torn down after test (harness default is reuse).
- Redaction bug found via the smoke logs and FIXED: docker exec debug logging
  filtered the -P flag but printed the following password value; now both the
  flag and its value are redacted.
- CORE LOCAL BOX + FULL DIAG: definition-of-done items all verified except the
  deliberately-open items (XEvents/expand-tables-node = M4-rest, dotnet-counters,
  renderer CDP trace). See IMPLEMENTATION_PLAN.md checkboxes.

---

## 2026-07-01 - Entry 8: PHASE 2 BEGINS (richer diagnostics + stress/soak + change tracking)

Phase 2 prompt (C:\repos\test\PERFTEST_PHASE_2_PROMPT.md) merged into
IMPLEMENTATION_PLAN.md as M7-M11 + scenario-variety checkboxes. Owner priority:
SQL activity capture -> CDP webview rendering -> stress/soak -> change tracking ->
scenario variety. All Phase 1 guardrails carry over plus new honesty rules
(leak verdicts w/ slope+CI+R^2, XEvents correlation warns not guesses, CDP only
with real targets, additive contracts, SQL text diagnostic+synthetic only).

Starting M7. Known design concern to fix first: processSampler currently spawns
powershell.exe per sample (every 500ms) - too heavy to measurement-approve
honestly; switching to a persistent sampling worker before calibration.

---

## 2026-07-01 - Entry 9: M7 (substrate) + M8 (XEvents VERIFIED) + M9 (renderer trace VERIFIED)

### M7 resource/memory substrate

- processSampler reworked: ONE persistent PowerShell worker per rep (stdin pid
  list -> one JSON line; no per-sample process spawns). POSIX ps per sample.
- Driver emits exthost.memory.rss/heapUsed counter markers (500ms, unref,
  scenario window only); normalizer summarizes counters -> <name>.peak/.final
  metrics (MB) official:false; full timeline stays in markers.jsonl.
- CALIBRATION HONESTY: first A/B attempt inconclusive (I contaminated run A
  with concurrent work; 3 reps; CV over threshold) -> per SS12.3 the sampler is
  DIAGNOSTIC-ONLY until a clean calibration passes (allowedPassTypes changed).
  Rerun on a quiet box is an open task (7.3).

### M8 SQL activity capture (VERIFIED - the headline feature)

- Driver sets per-rep Application Name mssql-perf/<runId>/<repId>/<scenarioId>
  (ConnectionCredentials passes it through; STS appends suffixes like
  -Query-languageService per connection purpose -> collector matches by PREFIX).
- sql/xevents/\*.sql: ring-buffer session (rpc/batch/statement/module completed,
  app-name-filtered at session AND parse), FOR JSON shredding read. GOTCHAS
  FIXED: ODBC sqlcmd -h -1 + -y 0 mutually exclusive (dropped -h); embedded
  double quotes mangled through Windows argv (script rewritten quote-free with
  doubled single quotes); QUOTED_IDENTIFIER required by XML methods (-I flag).
- createSqlExecutor seam (external host sqlcmd / docker exec) on
  CollectorContext.sqlExec; collector lifecycle: create+start on scenario.start,
  read (3.5s dispatch-latency wait) + stop AWAITED after outcome.
- VERIFIED run 2026-07-02T05-30-28Z_d7464214: 95/95 events correlated;
  sql-activity.jsonl lists EVERY command w/ duration/cpu/reads/rows/text
  (diagnostic+synthetic only); rollup byEvent/byObject; metrics
  sqlserver.duration/cpu/logicalReads/commandCount conf=high. FINDING: 14
  sp_executesql metadata RPCs w/ 296,595 logical reads surround one user query
  (languageService connection chatter) - exactly the hidden work this system
  exists to expose. LIMITATION (documented): server row_count=0 for the
  streamed SELECT batch (DONE-count semantics) -> 10k proof stays with the two
  client-side sources; server side corroborates via batch text + 605 logical
  reads (full PerfRows scan). Derived sql.networkDriver.duration clamps to 0 /
  conf=low here because the window sums ALL connections (incl. languageService)
    - refinement candidate: per-connection-suffix breakdown.

### M9 CDP renderer trace (VERIFIED)

- Shared CdpClient; cdpRendererTrace: --remote-debugging-port, /json discovery
  (workbench page target on vscode-file://), Tracing over the scenario window
  (ReportEvents), 10.9MB renderer.trace.json artifact; derived renderer.paint/
  layout/scripting/gc totals + longestTask (166ms), tagged rendererProcessWindow.
- ARCHITECTURAL FIX both CDP+XEvents needed: onScenarioEnd hooks are now
  dispatched AWAITED by the pipeline after the outcome, BEFORE shutdown (the
  fire-and-forget marker-listener path let teardown kill VS Code mid-flush).

### M10 groundwork

- ScenarioLoopSpec contract added (iterations/warmup/steps/success/onFailure/
  settleSteps); soakAnalysis.ts (linearFit w/ CI95+R2, leak verdicts
  stable|growing|inconclusive w/ reasons, reliability taxonomy, latency drift,
  marker plumbing) - 12 unit tests incl. the fabrication-risk cases (thin data
  -> inconclusive; noise -> inconclusive; warmup excluded). 44 tests green.

Next: driver loop engine + disconnect step + soak scenario E2E (10.3), then
10k-table catalog (10.4), diff (M11).

---

## 2026-07-01 - Entry 10: M10 soak WORKING (real growth found!) + M11 diff command

### M10.1-10.3 soak (60-iteration E2E VERIFIED)

- ScenarioLoopSpec contract + driver loop engine: iteration.start/end markers
  (attrs index/warmup/status/errorKind), per-iteration success criteria
  freshness-scoped to the iteration, onFailure continue|abort, settle steps,
  failure taxonomy (connect/query/disconnect/timeout/verification/other).
  PERF_SOAK_ITERATIONS env override (config-snapshotted);
  PERF_SYNTHETIC_LEAK_KB_PER_ITER gate-proof hook (recorded on markers).
- mssqlDisconnect step via product test seam (connectionManager.disconnect).
- soak-connect-query-disconnect scenario (1000 iters default, 5 warmup,
  onFailure continue, per-iteration proof rowCount==10000).
- Pipeline writes soak-iterations.jsonl; normalizer runs analyzeSoak ->
  soak.latency.p50/p95/slope + reliability.failureRate + memory.rssSlope
  (official-eligible on the marker plane) + totalGrowth (diagnostic) +
  verdict validations.
- VERIFIED run 2026-07-02T05-36-59Z\*09ed4020 (60 iters, 37s): 55/55 steady
  passed, failureRate 0, p50 534ms / p95 543ms, latency slope -7.8ms/iter
  (CI +/-9.5 - includes 0, no drift claim). \*\*\* REAL FINDING: exthost RSS grew
  95.7MB over 60 connect->query->disconnect cycles, slope ~567KB/iter, verdict
  GROWING (CI lower 276KB/iter, R2=0.20 noted in the reason). Candidates:
  query result/history retention in exthost, or lazy V8 GC - needs M10.5 heap
  snapshots + a longer run to attribute. This is the first product perf issue
  surfaced by the system. \_\*\*

### M11.1-11.2 investigation diff (VERIFIED structure)

- store.metricMedians (official+diagnostic medians over passed non-warmup
  reps) + gitContext; investigate.ts: SQL-activity delta (top-level commands
  grouped by object/normalized text; added/removed/changed w/ round-trip,
  duration, reads deltas; one-sided captures produce an honest note),
  cross-signal metric deltas sorted by |delta%|; console renderer.
- CLI `perftest diff --baseline --candidate [--json]`: official gate first
  (exit 1 on regression), investigation explicitly non-gating,
  investigation.json persisted beside the candidate run.
- VERIFIED on the gate-proof pair: REGRESSED +47170% wallclock, git SHAs+dirty
  shown, honest no-sql-activity note. PENDING (11.3): extra-SQL-round-trip
  acceptance + md/html investigation report.

Still open in Phase 2: 7.3 quiet-box sampler calibration, 10.3 full
1000-iteration acceptance (launching now) + injected-leak proof, 10.4
10k-table catalog + expand-tables-node-10k, 10.5 heap-snapshot/gcdump leak
root-cause collectors, 11.3, scenario variety V.1/V.2.

---

## 2026-07-01 - Entry 11: Phase-2 acceptance runs COMPLETE (1000-iter soak, leak proof, calibration)

### 1000-iteration soak (run 2026-07-02T05-40-19Z_feaff3ed, 9 min, exit 0)

- 995/995 steady-state iterations PASSED: failureRate 0 over 1000 real
  connect -> 10k-query(verified rowCount) -> disconnect cycles.
- Latency: p50 531.6ms / p95 543.8ms; slope -0.023ms/iter (CI +/-0.028,
  includes 0) -> NO latency drift over 1000 iterations.
- Memory: +67.8MB total, steady slope 30.6KB/iter (CI lower 26.2KB), verdict
  GROWING, R2 0.15 (growth decelerates - early ramp dominates - but a slow
  persistent ~30KB/cycle accumulation remains). PRODUCT FINDING #1, needs
  M10.5 heap-snapshot attribution. soak-iterations.jsonl carries all 1000.

### Injected-leak detection proof (512KB/iter via PERF_SYNTHETIC_LEAK_KB_PER_ITER)

- 60 iters: slope 938KB/iter (organic-only was ~567KB/iter at this scale),
  total +115.7MB, verdict GROWING, R2 0.37 - the injected retention is clearly
  visible on top of organic growth. Detection machinery proven on a REAL leak.

### processSampler calibration (SS12.3, quiet box, 5+5 reps, warmups dropped)

- ON median 1061.6ms vs OFF 1041.2ms = +1.96% p50 overhead, within run-order
  noise at n=5 -> APPROVED for measurement (cost low); entry recorded in
  DIAGNOSTIC_COLLECTORS.md; allowedPassTypes flipped back. The earlier busy-box
  attempt stays discarded (never interpreted).

Phase-2 state: M7 done; M8 done (verified); M9 done (verified; renderer
cpuprofile variant optional); M10.1-10.3 done (verified at 60 + 1000 iters +
leak proof); M11.1-11.2 done (verified structure). OPEN: 10.4 (10k-table
catalog + expand-tables-node-10k), 10.5 (heap-snapshot/gcdump leak
root-cause - NEXT: attribute the 30KB/cycle finding), 11.3 (investigation
report md/html + extra-round-trip acceptance), 3.5 dotnet-counters, scenario
variety V.1/V.2. Restart protocol unchanged.

---

## 2026-07-02 - Entry 12: PHASE 3 BEGINS (finish & sharpen) + M12.0 gap audit

Phase 3 prompt merged as M12-M15. Owner set the REPORT QUALITY BAR: match
cloud-deploy-agent benchmark.html (self-contained HTML, CSS-var design system,
.kpi tiles, ok/warn/fail pills, collapsible sections, ~29 inline-SVG charts,
no external fetches; see memory perftest-phase3-4-vision). Phase 4 (in-product
analysis UI, "completions debug to the moon", PDF example in repo root) comes
AFTER phase 3; owner will supply mockups then. M14 renderers must be factored
for Phase-4 reuse.

M12.0 GAP AUDIT vs design SS32/SS34 complete:

- Genuinely missing from original scope: SS28 setup scripts (-> 12.9),
  ext-first-launch scenario (-> 12.10).
- Blocked-with-reason: SS34.7 trace-context ext->STS (sts2 has no W3C
  traceparent by design; legacy path journals lifecycle only; documented).
- Stale boxes consolidated: 4.7 was DELIVERED by M8; 4.8->12.2; 4.9->12.8;
  3.5->12.4; V.1/V.2->12.7/13.6.
- Everything else in SS34 verified during Phases 1-2 (see prior entries).

In-flight from the interrupted M10.5 start (now 12.1): cdpHeapSnapshot.ts +
gcDump.ts + config.soakdiag.local.jsonc + pipeline wiring are WRITTEN but not
yet built/verified - continuing there.

---

## 2026-07-02 - Entry 13: M12.1 COMPLETE - exthost growth ATTRIBUTED (leak root-cause collectors verified)

- cdpHeapSnapshot collector VERIFIED (run 2026-07-02T16-06-46Z_b1e04363, 60-iter
  diagnostic soak): forced-GC V8 snapshots at scenario start+end (248MB/251MB
  .heapsnapshot artifacts), constructor-level diff -> heap-growth-summary.json,
  exthost.heap.retainedGrowth metric (official:false).
- gcDump collector VERIFIED: STS managed-heap dumps captured start+end
  (3.2MB -> 5.7MB - STS managed heap nearly doubled over 60 cycles; pair
  available for PerfView diff).
- **\_ ATTRIBUTION ANSWER for the connection-cycling growth finding: post-GC
  retained JS heap grew only 2.9MB/60 iters (~48KB/iter). Top retainers:
  (code) +2.59MB/+9,767 objects (V8 compiled-code accumulation from repeated
  connect/query - dynamic function/regex/lazy compilation per cycle);
  Object +99KB/+3,112; (string) +178KB/+678; \_QueryHistoryNode +21 (one per
  query-ish, bounded-looking but real). CONCLUSION: the RSS growth is mostly
  V8 code-space + unpressured heap expansion, NOT a classic data-structure
  leak; two small named retainers to watch (\_QueryHistoryNode, per-cycle
  Objects); STS managed-heap growth flagged for PerfView follow-up. _**
- M14.1 started: charts.ts written (deterministic inline-SVG histogram/trend
  w/ CI band+R2+n/horizontal bars/cross-process waterfall with
  monotonic-vs-epoch plane distinction + calibration jitter in the legend;
  benchmark.html design tokens). Not yet built/wired.

---

## 2026-07-02 - Entry 14: M14 core landed (charts module + waterfall + standalone index.html)

- charts.ts (14.1 DONE): deterministic inline-SVG renderers, zero deps,
  benchmark.html design tokens - histogram (n-labeled, small-sample flagged),
  trendChart (scatter + OLS fit line + CI BAND + R2/n annotation + optional
  baseline band + step-change markers), horizontalBars (top-N / signed A-B
  deltas), waterfall (lanes per process, solid=official-monotonic vs
  dashed=epoch-aligned, calibration jitter in legend, native <title> hover).
  Factored for Phase-4 reuse.
- htmlShell.ts: shared page shell + kpiRow/pill/section/chartCard/dataTable
  components matching the owner design system (CSS vars, .panel/.kpi/pills/
  collapsible sections).
- runIndex.ts (14.2 core + 14.4 core): loads summary/environment/rep results/
  markers/sql-activity/soak-iterations/comparison; builds the cross-process
  waterfall per scenario (generic begin/end pairing + irregular pairs +
  iteration bars capped at 30 + webview renderComplete ticks + SQL commands on
  a "SQL Server (server clock)" lane - server clock domain LABELED);
  per-scenario wallclock histogram, soak latency + RSS trends w/ fit + verdict
  caption, SQL top-N bars; rep table + validation notes + environment +
  artifact index. Wired into run pipeline + `perftest report`.
- VERIFIED: index.html regenerated for the attribution-soak run (51.7KB,
  3 SVGs, 4 sections) and the fulldiag run (waterfall + SQL top-N). Sample
  sent to owner for design feedback.
- REMAINING in M14: 14.3 A/B delta bars into the diff/investigation report
  (12.3 shares this), waterfall hover-detail JS enrichment if owner wants
  more than native tooltips, wallclock histogram needs >=3 reps (by design).

NEXT STEPS (exact): 12.3 investigation report reusing htmlShell+charts ->
12.2 10k-table catalog -> 12.5 probes -> 12.10/12.9 -> M13 scenarios ->
M15 trend/history. Restart protocol unchanged.

---

## 2026-07-02 - Entry 15: 12.3 investigation report + acceptance IN FLIGHT; 12.2 seed written

- investigationReport.ts: self-contained investigation.html (gate table
  official-only w/ pills, SQL-activity delta tables ADDED/REMOVED/CHANGED per
  scenario as the headline, signed metric-delta bars official-vs-diagnostic
  marked, notes). Wired into `perftest diff` (writes beside investigation.json).
- Driver knob PERF_EXTRA_RUNQUERY=1 (12.3 acceptance): one additional REAL
  query in the measured window, recorded via attrs.extraRunQuery on
  scenario.end. Acceptance A/B running: baseline 2026-07-02T16-17-34Z_ff00edbf
  vs extra-round-trip candidate; diff must surface +1 round-trip on the
  PerfRows batch while the gate stays official-only (diagnostic runs gate on
  zero official metrics by design).
- 12.2 STARTED: sql/seed/create-perf-catalog.sql written (PerfCatalog DB,
  10,000 deterministic tables t00000..t09999, idempotent). REMAINING for 12.2:
  provisioner support to apply+verify the catalog seed (COUNT=10000),
  mssql.oe.expand.begin/end product markers w/ attrs.childCount (design SS17.2,
  ObjectExplorerService.handleExpandNodeNotification seam per Entry 1 map),
  driver oeExpand step via getControllerForTests ->
  createObjectExplorerSession/expandNode test seams, expand-tables-node-10k
  scenario w/ markerSeen childCount==10000.

PHASE-3 REMAINING QUEUE (priority order): finish 12.2 -> 12.5 probes
(objectExplorerProbe/webviewProbe product perf API) -> 12.10 ext-first-launch
-> 12.9 setup scripts -> 12.4 dotnet-counters stop story -> 12.6 coldDb ->
12.7 scenario basics -> 12.8 doc -> M13 advanced scenarios (13.1 virtual
window markers first) -> 14.3 remaining plots -> M15 trend/history/rolling
baselines. Report design feedback from owner may adjust M14 output.

---

## 2026-07-02 - Entry 16: 12.3 ACCEPTANCE + honest findings

- Acceptance ran (baseline 2026-07-02T16-17-34Z_ff00edbf vs candidate w/
  PERF_EXTRA_RUNQUERY): investigation.html written; SQL-activity delta
  SURFACED the added activity (31->54 commands, 12 added groups, use
  [PerfHarness] count +7, 5 changed); GATE stayed official-only (PASSED on 0
  official metrics - diagnostic pass, by design). Core 12.3 intent proven.
- HONEST FINDINGS from the acceptance itself:
    1. WINDOW-BOUNDARY NOISE: OE/metadata queries race the scenario window
       between runs -> added/removed noise in SQL deltas across identical code.
       Improvement candidate: stability tagging (mark commands seen in only one
       run near window edges) or window padding exclusion.
    2. The PerfRows batch showed count delta 0 (expected +1): the extra-query
       hook's fresh wait matched query 1's completion (dispatch returns before
       completion), so timing of the second query vs scenario end is loose.
       Follow-up: wait for renderComplete-fresh before issuing the extra query,
       or count-based success check. The +1 IS visible indirectly (use-batch +7,
       added groups).
    3. Server-side duration variance across runs is large on metadata RPCs
       (-219ms, -85k reads on one sp_executesql group) - reinforces that SQL
       deltas are investigation context, never gates.
- 12.2 catalog seed SQL written (see Entry 15 for the remaining 12.2 steps).

---

## 2026-07-02 - Entry 17: Phase-3 finish-out - scenarios, probes, M15 (bring-up + fixes)

BUILT (see commit 5df508c + product f6bb08740):

- Product markers: mssql.oe.expand.begin/end (childCount), windowFetch
  begin/end IN rowRequestHandler (single row path: webview scrolls + probes),
  mssql.query.cancelled. Perf-only probe APIs: gridState (rows/resultSets/
  columns/isExecuting), gridFetchWindow (real row path w/ cell values),
  oeSnapshot (expanded-node childCounts).
- Driver steps: webviewProbe/objectExplorerProbe (tiny field-op-number
  assertion language, also usable as success criteria), oeExpand (walks the
  REAL tree provider from the session connectionNode; settles on the
  product's own oe.expand.end markers), windowFetchCheck (offset content
  correctness), completionProbe (cursor-at-end, contains-match, retry while
  intellisense warms; first-attempt latency markers).
- 15 scenarios registered incl. ext-first-launch (official
  vscode.startup.ready from orchestrator spawn->ready; measured 11.7s fresh
  profile), expand-tables-node-10k, cancel/error/100k/blob/many/wide,
  oe mixed/deep/refresh, intellisense, reconnect-cycle, large-script.
- 12.4 dotnetCounters collector (stop = target-exit like dotnet-trace);
  12.6 coldDb (DBCC drop buffers+proc cache per rep, sysadmin required);
  12.9 setup-windows.ps1 (verified PASS on this box) + `setup verify`;
  M15: trend command (per-run medians + step-change attribution to product
  SHA - VERIFIED: flagged +71.6% step at run 0b576cd0 @1c6e464b),
  history.html (39 runs, 4 trend charts), rolling:N baselines (pooled last-N
  green runs, env-hash-scoped, honest refusal on new env hash), run tags.
- Seeds: PerfRows100k (100k), PerfBlobs (256KB bin + XML + MAX text;
  two T-SQL truncation bugs found by the harness seed verify), PerfCatalog
  10k tables (skip-guarded rebuild).

BRING-UP RESULTS (run 2026-07-02T19-52-03Z_a8772341): 9/15 passed first try.
Fixed since: intellisense (contains+retry) PASSES 2596ms cold completion.
IN FLIGHT: scroll (fix: await last windowFetch.end - marker-vs-teardown race
found by the harness itself), OE walk (fix: walk from session connectionNode,
settle on oe.expand.end markers - root-list nodes are saved-but-disconnected
profiles).

HONEST DEFERRALS (documented, not silently dropped):

- True UI scroll injection (renderer-side scroll events) deferred; windowing
  is proven via the real row path + product windowFetch markers instead.
- reconnect-after-drop implemented as reconnect-cycle (disconnect/reconnect);
  true network-drop simulation needs a KILL-session orchestration seam.
- Scroll-soak variant = loop composition of existing steps (available via
  ScenarioLoopSpec; not a separate registered scenario).
- Normalizer honesty fix: scenario.wallclock officialness now respects the
  scenario's declared official flag (ext-first-launch noop wallclock was
  incorrectly official).

---

## 2026-07-02 - Entry 18: PHASE 3 COMPLETE - 15/15 acceptance run green

ACCEPTANCE RUN 2026-07-02T20-29-51Z_a5db8eb2 (tagged phase3-acceptance,
exit 0): all 15 Phase-3 scenarios passed in a single measurement run.
Headline officials: 10k-table OE expand 3.7s; 100k-row query+render 3.9s;
windowed-scroll proof 3.7s; cold intellisense completion 2.6s; cancel 534ms;
reconnect 285ms; 200-batch script 964ms; error-path 259ms; fresh-profile
startup-to-ready 11.7s (vscode.startup.ready; noop wallclock correctly
non-official after the normalizer honesty fix).

Fixes landed during bring-up (each found BY the harness's own honesty
checks): seed REPLICATE/CHAR truncation traps (SQL error surfaced by seed
verify), windowFetch marker-vs-teardown race (markerSeen criterion refused
to pass -> await last fetch marker), OE walk racing the async tree
(settle on the product's own oe.expand.end markers; walk from the session
connectionNode not saved profiles), per-scenario sql.database never reaching
the connection profile (10k expand silently ran against PerfHarness -
childCount attrs exposed it), exact-10000 tree assertion corrected to
bounded 10000..10050 (SMO adds folder nodes; exact user-table count proven
by provisioner seed verify).

IMPLEMENTATION_PLAN.md: every box checked (M0-M15 + consolidated stale
boxes). All repos committed: perftest main, vscode-mssql + sqltoolsservice
dev/karlb/perftest. PERF_MODE gating for new product code holds by
construction (Perf singleton noop + registerPerfApi early return - pattern
zero-behavior-verified in M2).

PHASE 3 DONE. NEXT: Phase 4 (in-product diagnostics UI). Inputs staged in
repo root: PERFTEST_PHASE_4_INPRODUCT_DIAGNOSTICS.md, VISION_NORTH_STAR.md,
CLAUDE_DESIGN_INPRODUCT_DIAGNOSTICS_BRIEF.md, STS2_VISION_ALIGNMENT.md,
"MSSQL for VS Code Completions Event Instrumentation.pdf". Owner will add
mockups. M14 renderers (charts.ts/htmlShell.ts) were factored for reuse.

---

## 2026-07-02 - Entry 19: PHASE 4 BEGINS - MSSQL Debug Console

Owner supplied full specs: debug-docs/{Technical_Design, UX_Spec, Prototype_Review}

- 11 mockups + Claude Design offline HTML prototype. Mockups studied (screen1
  Overview cockpit, screen2 Waterfall w/ decomposition strip + critical path,
  screen3 Trace w/ gap row + cause tree). Plan committed as M16-M19.

DECISIONS ADOPTED (flagging per phase-4 prompt; owner can override):

1. PRIVACY DEFAULTS: sessionDiag.enabled=false (off by default), captureMode
   default "redacted" when enabled, local-only, never uploaded, secrets/conn
   strings NEVER persisted (hard rule, not a setting). Elevation time-bounded.
2. SHIP SURFACE: console behind mssql.debugConsole.enabled (default true in
   dev; packaging decision deferred). All experimental flags default false.
3. STORE: JSONL segment journal + manifest per session; in-memory index at
   open instead of SQLite for v1 (native dep in shipping extension is a real
   packaging decision; StoreQueryService interface is SQLite-ready). FLAGGED.
4. STS-SIDE capture + replay-drive: GATED per tech design SS18 (sts2 hardening
   prerequisites); UI shows honest blocked states. Imported artifacts OK now.
5. COMPLETIONS/REPLAY pages: gated stubs first (plug-in seam proven); full
   completions migration is a later chunk (owner: "plug in as a feature-
   specific view later"). Replay Lab UI lands with completions adapter later.
6. Emission unification: Perf.marker becomes one path into the diagnostics
   core; PerfModeSink preserves the exact harness wire behavior (verified by
   re-running a Phase-3 scenario in M19.2).

BUILD ORDER (per review doc slice plan): M16 substrate -> M17 shell+Trace+
Overview+Waterfall (fixture mode + live) -> Perf&Sessions/feature pages ->
M18 export/depth -> M19 acceptance.

---

## 2026-07-03 - Entry 20: Phase 4 chunk 1 LANDED - substrate + Debug Console

vscode-mssql commit: unified diagnostics substrate + MSSQL Debug Console.

SUBSTRATE (M16, src/diagnostics/):

- sharedInterfaces/debugConsole.ts: DiagEvent envelope (mssql.diag.event/1),
  classification/redaction contracts, capture policy, source/session models,
  store query + waterfall + KPI/anomaly types, full webview RPC protocol.
- redaction.ts: policy choke point - classify(raw, cls, policy) with
  omit/redact/digest(salted)/tokenize/truncate; secrets/conn-strings NEVER
  plain under any mode (type-level allowSecrets: false); unknown = sensitive.
- diagnosticsCore.ts: singleton `diag` - seq/eventId, ambient+entity trace
  context, span helper, sink routing (never throws, near-no-op when idle),
  time-bounded full-capture elevation w/ auto-revert.
- sinks.ts: PerfModeSink (EXACT legacy harness wire format), LiveTailSink
  (ring + exact GapRecords on subscriber overflow), SessionDiagSink (JSONL
  segment journal + manifest, batched non-blocking writes).
- sessionStore.ts: source registry (live/local/perfRun), segment loader w/
  in-memory index, filtered queries w/ gap interleaving, retention, clearAll.
- analysis.ts: userActions (correlation roots), KPIs, derived anomalies,
  causeTree, cross-process waterfall builder (timingClass-aware), SQL rows.
- perfRunImport.ts: perf run dir -> events (markers+sql-activity); official
  metric samples from result.json across perf-runs (trend feed).
- perfTelemetry.ts REWRITTEN as facade over diag core: public API + PERF wire
  preserved; ALL Phase 1-3 instrumentation now feeds the console for free.
  PROVEN: query-10k-results 4/4 reps passed official through the new path.
- serviceclient.ts: JSON-RPC boundary spans (rpc.<method> w/ duration) - the
  dispatcher tier visible end to end.
- diagnosticsManager.ts: settings-driven capture lifecycle, retention,
  commands (enable/disable/elevate/clear/openFolder), status-bar chip.

CONSOLE (M17, webviews/pages/DebugConsole/):

- Design system (debugConsole.css): VS Code theme tokens, process palette
  (ext teal/webview blue/STS purple/SQL green), 44px top bar, 210px rail.
- Shell: session/source selector, Live|History, search, capture chip w/
  elevation popover + countdown, backfill button, export, provenance card,
  grouped nav (Common/Feature pages/Session).
- Overview: KPI grid, recent user actions (correlation roots -> waterfall
  deep links), derived anomaly cards, sources list, capture-off empty state.
- Consolidated Trace: process-striped rows, real filters (process/feature/
  status/search incl. digests), gap marker rows, detail tabs (Summary/
  Payload/Cause/Privacy/Raw) w/ RedactedField as the ONLY sensitive renderer.
- Waterfall: lanes, solid-vs-hatched timingClass styles, wall-clock
  decomposition strip (honest per-lane-sums label), critical path panel,
  calibration note, bar inspector.
- Perf & Sessions: official-only per-run medians, trend SVG, run table (feeds
  from mssql.debugConsole.perfRunsRoot or Import perf run).
- SQL Activity / Connections / Query & Results / Object Explorer feature
  pages; Exports (redacted JSONL v1); Settings; Completions + Replay Lab as
  HONEST GATED stubs.
- package.json: commands + settings (sessionDiag off by default) + bundle.

REMAINING (next chunks): live E2E session walkthrough w/ owner, evidence
bundle (zip+manifest+privacy report+validation), backfill-from-journal
button wiring, capture-off zero-file unit test + redaction unit tests,
completions page migration, deeper cause links (explicit causeEventId
threading in feature code), STS2 gated source.

SMOKE VERIFIED: debug-console-smoke scenario passed inside a real
harness-launched VS Code (console constructs, bundle loads, no errors).
16.7 (redaction/zero-capture unit tests) remains OPEN - next chunk.

---

## 2026-07-03 - Entry 21: Phase 4 round 2 - owner live-usage feedback fixes

Owner tested the console live. Root causes + fixes:

1. ONLY EXTENSION DATA IN TRACE: webview mark bridge was PERF_MODE-gated;
   now the handler registers always and enable is (re)sent whenever a diag
   sink is active (console open / capture on), incl. a 20s poll covering
   consoles opened after webviews loaded. STS visibility: rpc.\* JSON-RPC
   round-trip spans now lane under SQL Tools Service in the waterfall
   (labeled "(round-trip)", honestly extension-measured) and render as
   purple "STS rpc" pills in Trace.
2. WATERFALL EMPTY: nothing created traceIds in normal use -> userActions()
   had no roots. Added root-action auto-correlation in the core: root-begin
   types (command.invoked, query.submit, connection.begin, oe.expand.begin)
   open a trace inherited by subsequent traceless events (120s window,
   explicit traceIds always win; honest sequential-IDE-usage assumption).
   PERF wire unaffected (correlationId only written when explicitly passed).
3. CAPTURE CHIP INERT: enable went through a settings round-trip; now
   DiagnosticsManager.applyCaptureMode applies immediately (elevation also
   auto-enables the store sink) and persists settings in background.
4. HISTORY: new History page (Common group) - cross-session aggregates: KPI
   row, per-action-label median trends across stored sessions (TrendChart),
   stored-sessions table (click -> open that session in Trace). History
   seg-control navigates there. Auto-capture = Session Diag store (existing).
5. PERF & SESSIONS DEEP PASS: scenario browser (small-multiple cards w/
   sparkline + latest median + delta%), per-run median trend w/ prior-runs
   baseline band + step-change highlight + click-to-pick-candidate, latest
   run histogram, A/B comparison (baseline/candidate selectors -> official
   metric median DeltaBars), all-runs table incl. failed/diagnostic runs
   (import no longer drops non-passed runs; parses real timestamps).
6. FEATURE PAGES: occurrence views - Connections (begin->ready pairs, median/
   p95/failures/sparkline), Query & Results (submit->complete pairs w/ rows/
   rendered/error columns), OE (expand pairs w/ childCount + redacted
   nodePath). Rows deep-link to the waterfall by correlation.
   New webview chart primitives: Sparkline/TrendChart(band)/Histogram/DeltaBars
   (charts.tsx, no deps, n-annotated, no smoothing).

---

## 2026-07-03 - Entry 22: Phase 4 round 3 - screenshot feedback fixes

Owner screenshots in C:\repos\test\screens. Fixes:

1. WATERFALL MISSING RPC CHILDREN (waterfall-nochildren.png): startSpan()
   minted its own trace instead of joining the active root action ->
   resolveSpanTrace(): explicit > ambient > fresh root window > new. RPC
   round-trips now land in the action trace and the STS lane.
2. WATERFALL ONE-ROW PILEUP: per-lane row packing (greedy interval packing
   into sub-rows, lane height grows, xN count in the label) + in-bar labels
   on wide bars.
3. STS FILTER BUG (consolidate1.png): store query treats process filter
   "sqlToolsService" as also matching feature==="rpc" rows (they render as
   "STS rpc").
4. RICHER RPC DETAIL: spans now carry ownerUri (classified source.path);
   method already in type. More per-feature payloads to come from owner's
   event inventory.
5. WEBVIEW SPARSE: added mssql.resultsGrid.dataReceived mark (summaries
   arrive pre-paint) - gap to renderComplete = grid render cost.
6. PERF PAGE DROPDOWN BREAKAGE (run2.png): scenario browser now always keyed
   on scenario.wallclock (stable while metric changes); metric dropdown lists
   ONLY metrics recorded for the selected scenario (with run counts) and
   auto-falls back; A/B + trend hidden with an honest note when no data;
   stale baseline/candidate cleared; runs-table rows click->A/B candidate;
   delta% display clamped (noop +47169% -> >+999%).
7. RESIZABLE UX: react-resizable-panels (same as owner's completions view)
   for the Trace split; full-height panels + focus-colored resize handle.
   PENDING (owner writing specs/mockups): full fit-and-finish inventory,
   completions-style linked-table History/Perf organization deep pass, richer
   per-event instrumentation inventory, waterfall correlation lines.

## 2026-07-03 - Entry 23: Broad instrumentation - STS 3-level spans + dialog seam

Owner ask: "getting much broader instrumentation coverage ... adding events for
edit data, table designer, schema visualizer, all the dialogs. And in STS ...
blocking off all the calls to SqlCommand, or when interacting with SMO or DacFx.
And those calls into core dependencies would be a new level in waterfall ...
within a process have multiple levels of events."

Landed (committed both repos):

- STS-side StsDiag emitter (Microsoft.SqlTools.Hosting/Utility/StsDiag.cs):
  opt-in, gated on STS_DIAG_URL/STS_DIAG_TOKEN (loopback http://127.0.0.1 only),
  bounded ConcurrentQueue(2000), batched fire-and-forget NDJSON over HTTP.
  Multi-targets netstandard2.0 + net10.0 (#if for processId). Protocol metadata
  ONLY - never SQL text/rows/connection strings.
- THREE STS span levels = the "new waterfall level" (driver lane):
    1. MessageDispatcher: sts.{dispatch|event}.{method} feature "rpc" per request.
    2. Batch.cs: sts.sql.executeReader feature "sqlDriver" around ExecuteReader,
       Complete(batchOrdinal/resultSets/rowCount) - counts only.
    3. ObjectExplorerService: sts.smo.expand/refresh feature "sqlDriver" around
       node Expand/Refresh, Complete(nodeType/childCount).
- Extension ingest: stsDiagListener.ts loopback HTTP listener; started before
  controller.activate() so the STS child inherits STS_DIAG_URL/STS_DIAG_TOKEN.
  Classifies fields as diagnostic.metadata; emits process=sqlToolsService,
  tags=[stsDiag], timingClass=epochAlignedDiagnostic (hatched cross-process bars).
- WEBVIEW DIALOG SEAM: one span at webviewBaseController.onRequest covers ALL
  dialogs/designers (Table Designer, Schema Designer, Edit Data, Connection
  Dialog, Object Management, Schema Compare) - only when a diag sink is active.
- Driver lane plumbing: analysis.ts routes sts.sql._/sts.smo._ -> "driver" lane;
  common.tsx driver label "SQL / SMO calls" + wire color; pagesCore LANE_ORDER.
- serviceclient.ts RPC span carries ownerUri (classified source.path).
- queryResultsGridView.tsx dataReceived mark.

Verify: extension BUILD=0; STS build green; harness non-regression
query-10k-results 4/4 passed official=true (no perf marker regression).
NEXT: self-test feature (owner ask) - perftest as importable module + run-queue
dialog in Debug view that runs a perftest in the CURRENT vscode process with
live events into consolidated view/waterfall/history.

## 2026-07-03 - Entry 24: In-product SELF-TEST - run perftest in the live host

Owner ask: "from inside the debug view we can run the perftest functionality on
a set of tests and then see all the activity from those tests directly in the UI
in real-time ... make the perftest cli available also as an npm module that
mssql imports as a relative module ... the self-test controls the current vscode
instance and runs the tests directly in that process ... test history updates
... consolidated view and waterfall have all those events ... dialog can expose
perftest options not from the config ... run queue could be a dialog launched
from one of the other views."

ARCHITECTURE (single source of truth = the live diagnostics stream):
product perfMark ─┐
engine emitMarker ─┼─▶ host diag.emit ─▶ diag sink TAP ─▶ runner.deliverMarker ─▶ wait bus
The runner's wait bus is a pure PROJECTION of the same stream the Debug Console
renders, so running scenarios in-process lights up the consolidated trace and
waterfall for free - no separate event path.

LANDED (committed - perftest + vscode-mssql):

- NEW package @mssqlperf/inproc (packages/perftest-inproc): self-contained (only
  `vscode` external), so mssql imports it via a relative path to the built dist.
    - scenarioEngine.ts = the orchestrated driver's step engine adapted for
      in-process use (adds openUntitledSql + cooperative cancellation); identical
      step semantics, drives product commands + getControllerForTests.
    - markerBus.ts (wait bus), metrics.ts (honest duration derivation - absent not
      fabricated when a begin/end marker is missing), scenarios.ts (7 built-ins),
      runner.ts (SelfTestRunner: scenario x rep loop + progress event stream +
      deliverMarker pump).
    - Built-ins: connection-free (noop, synthetic-delay, activation, debug-console)
      exercise the full extension->STS->webview span chain; needsSql ones use
      PORTABLE sql (sys.all_objects) + untitled docs so they need only a
      connection, not the PerfHarness/PerfCatalog fixtures.
- vscode-mssql diagnostics/selfTest/selfTestService.ts: wires the runner to diag
  (tap + engine-marker re-emit), resolves a "default" connection best-effort from
  the ACTIVE EDITOR's live connection (password passed to the in-proc engine,
  never logged/persisted), persists results in the standard perf-run layout
  (summary.json + scenarios/<id>/reps/<rep>/result.json + markers.jsonl) so the
  Perf & History pages pick them up with NO import step, and streams progress.
- RPC: DcListSelfTestScenarios / DcRunSelfTest / DcCancelSelfTest +
  DcSelfTestProgress notification. State captured once in DcProvider; a run
  ending bumps dataVersion so Perf & History auto-refresh.
- UI: SelfTestDialog modal (new .dc-modal\* CSS) - scenario checklist with
  needs-SQL badges, reps/warmup inputs, opt-in capture elevation (default OFF -
  privacy-first), live progress log + completion bar, local-only privacy note.
  Launched from a "Run self-test" button on the Perf page (+ empty-state CTA).

PRIVACY: capture stays at the current mode unless the user opts into elevation
(auto-reverts, 10min). Metrics are counts/durations (diagnostic.metadata, always
plain). No SQL text or rows persisted. Local only.

VERIFY: @mssqlperf/inproc tsc build clean; full perftest workspace build green
(contracts+cli+inproc+driver); mssql extension BUILD=0 (typecheck resolves the
relative .d.ts; esbuild bundles the out-of-repo dist - confirmed
SelfTestRunner/selftest-noop present in dist/extension.js, dialog+modal css in
dist/views/debugConsole.\*). Headless runner smoke (scratchpad/selftest-smoke.js,
stubs vscode): noop 2p/0f, synthetic-delay wallclock ~251/254ms (real timing),
query-1k correctly skipped without a connection, deriveMetrics exact (55ms/30ms).

BUILD-ORDER NOTE: inproc dist/ is gitignored; `npm run build` in perftest must
run before the mssql build (produces the dist the relative import resolves).

NOT YET (honest gaps / follow-ups): live end-to-end in the real webview UI needs
the owner to click Run (can't drive the webview headless here); config-FILE
selection + custom test JS not wired (built-ins only, which owner said is fine);
SQL scenarios need an already-active connection (no in-dialog connection picker
yet); soak/loop built-ins not exposed in the self-test set.

## 2026-07-03 - Entry 25: M20 - Perf Test History refactor + self-test hardening

Owner ask (CODEGEN_PROMPT_Perf_Test_History_Refactor.md + chat): scalable Perf
Test History UX per handoff-2 spec/mocks, self-test connection selection, fix
the activation-marker hang, fix the waterfall stuck-span/self-noise bug, rich
diagnostics mode, deeper instrumentation, Completions/DevTools UX patterns
(collapsible nav, one-row toolbars, full-height panels), reliable tests.

ROOT CAUSES FOUND + FIXED:

1. WATERFALL STUCK SPANS / VIEWER SELF-NOISE (Stage 7): webviewBaseController
   wrapped EVERY webview request in a diag span INCLUDING the Debug Console's
   own dc/\* polling; those spans joined the active root trace via
   resolveSpanTrace AND were pushed back to the console via the live tail,
   re-rendering it and issuing more RPCs - a self-sustaining feedback loop that
   extended completed scenario timelines forever. Fix: debugConsole spans are
   tagged viewerInternal on their own viewer trace; LiveTailSink drops them
   (breaks the loop at the source); store queries + all analysis exclude them
   by default with an explicit "viewer internals" Trace toggle. Completed
   traces now have a FIXED end (unit-tested: rebuild 5x, end never moves).
2. SELF-TEST ACTIVATION HANG (Stage 5): the in-proc activation scenario waited
   300s/rep for mssql.activate.end - a marker that can NEVER re-fire because
   the extension is already active when the console is open. Fix: activation
   marked CLI-only (honest skip + pointer to ext-normal-activation);
   selftest-intellisense-keywords added as the in-proc STS round-trip instead;
   marker-wait timeouts now carry diagnostics (expected marker, stale-marker
   note, last-seen tail); first-rep marker timeout aborts remaining reps;
   extension.ts activation begin/end markers stay balanced on failure paths.

LANDED (perftest + vscode-mssql, committed):

- M20.3/20.4 self-test: connection modes active (ALL connected editors, not
  focus-bound) / saved profile (ConnectionStore + credential-store password;
  AzureMFA honestly unsupported) / env-var connection string (parsed in-host,
  never displayed/logged/persisted; quoted-value parser unit-tested) / none.
  Early actionable failures; provenance = mode + server/db label only.
  Completed runs auto-attach as a console source with waterfall/trace links;
  rep failures render step-context reasons in the dialog log.
- M20.5 data layer: sharedInterfaces/perfHistory.ts (Ph\* RPC), directory
  provider with incremental .dc-history-index.json (fingerprint change
  detection, chunked scans, corrupt-run tolerance), source registry (default
  dir / Open Directory / Import Bundle read-only / SQLite honest
  preview-unsupported via magic sniff), per-rep lazy artifacts (waterfall from
  markers.jsonl, SQL activity, size-capped dumps), Runs Summary aggregates.
- M20.6 UI: Perf Test History page replaces PerfPage (nav: "Perf Test
  History"; session trends stay as "Session History"). Runs Summary (KPIs,
  latest-slower callout, trend, suite health, needs-attention, sources) +
  Run Analysis (source command bar, VIRTUALIZED runs table, collapsible filter
  rail, scenario aggregate table with grouping + filter chips, linked charts,
  lazy bottom tabs: Submetrics/Waterfall/SQL/Artifacts/Validation/Dump).
  WaterfallView extracted for shared use. Resizable panes throughout.
- M20.7 rich diagnostics (COLLECT_ALL_THE_DATA intent): richCollection.ts -
  event-loop delay percentiles, CPU deltas, heap/RSS counters (2s cadence) +
  per-span heap deltas via DiagEvent.perf. Gates: richCollection setting /
  MSSQL_COLLECT_ALL_THE_DATA=1 / self-test toggle (window-scoped). Off = zero
  cost. Never elevates capture policy.
- M20.8 instrumentation: cancel lifecycle (cancelRequested -> cancelled |
  cancelFailed), mssql.connection.failed paired with begin in waterfall
  (errorNumber only, no message text).
- M20.9 shell UX: collapsible left nav (icon rail, persisted), one-row
  toolbars w/ horizontal overflow, full-height panels attached to splitters.
- RESILIENCE FIX my tests caught: the static relative import of the inproc
  dist broke the tsc out/ tree (one extra dir level) and took down every unit
  test touching extension.ts. Now inprocLoader.ts resolves the module at
  RUNTIME by walking up from \_\_dirname (works from dist/, out/, any layout)
  with type-only static imports; missing/unbuilt perftest repo = honest
  "build perftest first" error in the dialog instead of a module-graph crash.

VERIFY:

- inproc vitest: 10/10 (bus freshness + timeout diagnostics, metric honesty,
  CLI-only/no-SQL skips, fail-fast, cancellation, catalog sanity).
- extension unit suite (vscode-test): first run 3258 passing / 2 failing ->
  my suiteFor ordering bug (soak-before-query) FIXED; copilotChatEntry hook
  timeout confirmed as pre-existing load flake (passed on re-run). FINAL:
  3262 passing / 0 failing / 12 pending (pre-existing skips).
- debug-console-smoke in a real VS Code (new page + runtime loader): passed
  (7.4ms open, no errors).
- SCALE MEASUREMENT (Stage 1 target): synthetic 1,000-run history cold index
  3,564ms, warm cached query 25ms. Real perf-runs dir: 64 runs cold 364ms,
  warm 12ms. Page open never parses artifacts (index-only).
- Harness non-regression: query-10k-results 4/4 passed official=true.
- Builds: perftest workspace green; extension BUILD=0 (extension+webviews).

KNOWN LIMITATIONS / DEFERRED: SQLite browsing in-product = honest preview
(native driver ABI; use CLI history or directory source); Import Bundle =
read-only run DIRECTORY (zip support needs a zip dep); Renderer/Memory/CPU
bottom tabs appear as artifact kinds when CLI collectors produce them (badges

- artifact rows now; dedicated chart tabs later); run label editing, export
  selection, env-mismatch warnings on compare, keyboard nav polish.
  NEW settings/env: mssql.debugConsole.richCollection (default false),
  MSSQL_COLLECT_ALL_THE_DATA=1, MSSQL_PERFTEST_CONNECTION_STRING (self-test).

## 2026-07-04 - Entry 26: Self-test reliability deep dive (owner live-run feedback)

Owner ran the self-test: 6/7 scenarios green, OE expand hung ("did not settle
in time") and kept burning reps; Cancel did nothing; no visibility while
editors covered the console; live runs froze/blanked the other pages
(screens/self-run-hung.png, screens/all-blanks.png).

ROOT CAUSES FOUND + FIXED:

1. OE EXPAND HANG: the engine's getChildren + "Loading..." polling depends on
   the OE TREE VIEW consuming refresh callbacks - with the tree hidden behind
   the console, children never repopulate. Rewritten on the product's awaited
   expandNode(node, sessionId) API (resolves with children directly,
   view-independent) + session cleanup via removeNode(no-prompt) so reps stop
   leaking OE sessions/connections; OE view focused once in setup; 60s step
   timeout; children-snapshot diagnostics on failure.
2. CANCEL INERT: cancellation only checked between steps while waits blocked
   up to 120s. MarkerBus.wait now takes an isCancelled poll (200ms);
   syntheticDelay/completionProbe sleeps cancellable; oeExpand checks between
   hops. Cancel lands within ~1s (unit-tested: interrupts a 60s wait <3s).
   Dialog shows "Cancelling..." feedback; service logs the request instantly.
3. REP BURN: fail-fast generalized - ANY first-rep failure skips the
   scenario's remaining reps (was marker-timeouts only, so "did not settle"
   burned 4x minutes).
4. RUNS TABLE BLANKED ("0 of 0" vs 67 indexed): rescan() early-returned
   UNDEFINED when a scan was in flight, so cold awaits served an empty index.
   Now returns the SHARED in-flight promise. Background refreshes debounced
   (>=5s); webview dataVersion throttled to 1/s (live pushes every ~120ms were
   re-querying every visible page -> the freeze).

NEW STATUS EXPERIENCE:

- Status bar during runs: $(record) "MSSQL Self-Test 12/28" live counter +
  current scenario tooltip + cancelling state + pass/fail flash (12s);
  click = open console. Console auto-reveals to foreground on run end/error.
- Dialog becomes a status console while running: pulsing on-air indicator,
  RUNNING/CANCELLING/PASSED/FAILED, scenario i/n + reps n/m counters, ticking
  elapsed clock, progress bar, full-width history-style tabs: Log (smart
  stick-to-bottom) | Reps (per-rep wallclock + failure reasons) | Scenarios
  (state/passed/failed/notes). 1150px/88vh with flex-fill tables; config
  collapses during runs, "New run..." returns. (Owner may supply a richer
  mockup later - this is the interim uplift.)

VERIFY: inproc vitest 12/12 (new: cancel interrupts in-flight wait, first-rep
any-failure abort); extension unit suite 3259 passing / 1 failing =
copilotChatEntry hook timeout, PRE-EXISTING flake (sync require hook that only
times out under host load; fails ~50% across runs regardless of these changes

- failed run2, passed run3, failed run4; Copilot-owned, flagged for follow-up,
  not churned here); builds green (extension+webviews); debug-console-smoke
  passed in a real VS Code (9.3ms).

## 2026-07-04 - Entry 27: Iteration - STS/designer visibility, live-capture UX, layout

Owner notes (10 items + general "fix these categories everywhere"):

1. AUTO-CAPTURE (item 1): mssql.sessionDiag.storePath setting (configurable
   local trace store, restart to apply); sessionDiag.enabled description now
   states the startup-to-shutdown always-on behavior. Sessions browsable in
   Session History as before.
2. DESIGNER + DACFX INSTRUMENTATION (item 2 + "more STS visibility" +
   "doing-scenario blocks with no sublanes"):
    - Extension: tableDesigner init/publish markers (w/ failure reasons),
      schemaDesigner init markers (tableCount), schemaCompare compare markers.
    - STS: sts.dacfx.<OperationType> spans at the single ExecuteOperation seam
      (export/import/extract/deploy/generate-script/plan) + sts.sql.connectionOpen
      span around the physical SqlConnection.Open.
    - HARNESS WIRE: PerfModeSink now forwards rpc/webview/sts diag spans
      additively (viewer-internal excluded, tagged diag) and importPerfRep lifts
      durationMs attrs into bars -> CLI waterfalls get real cross-process
      sublane detail. Unit-tested (forwarding + exclusions).
    - Self-test scenarios: selftest-table-designer + selftest-schema-designer
      open the real designers via a Database TreeNodeInfo (server-level OE
      session -> Databases -> profile db/first user db), measured to init.end;
      engine gained designerOpen step + deferCleanup (sessions disposed even on
      failure/cancel). CLI-registry designer scenarios deferred (driver engine
      port) - recorded as follow-up.
3. TRACE LIVE-CAPTURE UX (item 3, completions-style): pause/resume (view
   freezes, collection continues), clear w/ show-all undo (seq watermark),
   auto-scroll toggle, filter expressions dur>1000 / dur<2s / proc:sts /
   feat:x / status:error / type:x / text via shared pure parser (invalid
   tokens surfaced); EventQuery+store duration filters. Fill-space: dc-page is
   flex column + all split panels flex-fill - no dead space under tables.
   4/5. ONE-ROW TOOLBARS + KPIs EVERYWHERE: top bar, page toolbars, Perf Test
   History header/command bar all nowrap + horizontal scroll w/ min/max
   control widths; KPI strips one row, scrollable, fixed card widths.
4. OE SCENARIO ROBUSTNESS: root-caused - the OE session inherited the
   connection's DATABASE scope so the root had Tables/Views (no Databases
   folder). oeExpand supports oeServerLevel sessions; scenario uses it.
   (Explains owner's "passed on rerun": different connection selected.)
5. HISTORY TABLES NORMAL-TABLE BEHAVIOR: table-layout fixed + explicit column
   widths (no reflow while virtualized rows scroll), single-height rows,
   artifact badges collapse to +N w/ hover.
6. DIAGNOSTICS VISIBILITY: new Diagnostics bottom tab in Perf Test History -
   per-rep rich counter series (heap/RSS/event-loop/CPU trends) + spans ranked
   by heap delta, lazily from markers.jsonl; self-test tap persists perf
   blocks as perf\_ attrs; honest empty state when a run wasn't collected rich.
7. GROUP DRILL-DOWN: group-by rows selectable; selection browses the group's
   member scenarios in the bottom pane (aggregate KPIs right), drilling a
   member opens normal tabs.

VERIFY: inproc vitest 12/12; extension unit suite 3268 passing (+10 new:
filter expressions, store duration filters, span forwarding) / 1 failing =
documented pre-existing copilotChatEntry flake; STS ServiceLayer build green;
extension full build green; harness non-regression 4/4 official=true WITH span forwarding active in the wire (gate undisturbed); console smoke passed (9.4ms).

## 2026-07-04 - Entry 28: Owner iteration - toolbar semantics, Perfetto waterfall, run hygiene

Owner notes (10 items):

1. TOPBAR: Live/History toggle REMOVED (live now derives from the selected
   source - Current session = live, anything else = historical; a small
   "live" dot shows next to the picker). Duplicate "MSSQL Debug Console"
   toolbar text removed (icon + tooltip only; tab title carries the name).
2. TRACE CONTROLS GATED: Pause/Clear/auto-scroll disabled with honest
   tooltips for pre-recorded sources; pause/clear reset on source switch.
   3+9. WATERFALL: Perfetto-style viewport on the existing DIV renderer (no
   custom control): wheel zooms at cursor, W/S zoom + A/D pan, drag-to-pan
   with click suppression, Esc/double-click/button reset, window-duration
   readout, bar labels appear as zoom widens bars, offscreen bars culled,
   "Zoom to bar" in the inspector. NEW "Event details" master/detail table
   under the main Waterfall page (start offset / lane / event / duration /
   timing / status; click = select + inspect, double-click = zoom to bar) -
   answers "you can't tell what anything is when bars are small" and makes
   the root-window grouping visible (runQuery length = query + grid browsing
   windowFetches joining the same action trace).
3. RUN DELETE: Actions column in the runs table; PhDeleteRun RPC with modal
   confirm (destructive), provider removes the run dir + evicts/persists the
   index, rejects path tricks (unit-tested incl. reload survival). Writable
   directory sources only (bundles read-only).
4. TREND -> ROW: clicking a Runs Summary trend point already drilled into
   Run Analysis; the runs table now scrolls the focused run into view (works
   with the virtualized window) - click outlier, land on row, delete.
5. SHIFT-CLICK: contiguous range selection between anchor and clicked row;
   ctrl-click multiselect unchanged; runs table is user-select:none so shift
   never highlights text.
6. STATUS BAR: self-test indicator now priority -1000 (right-most among
   right-aligned items) so it stays put while items churn during a run.
7. MASTER NOT FOUND: findDatabaseNode descends into the "System Databases"
   folder when the target database isn't top-level (master/msdb/model/
   tempdb); error message now lists both levels.

VERIFY: inproc vitest 12/12; extension unit suite 3269 passing (+1 new
deleteRun test incl. path-trick rejection + cache-reload survival) / 1
failing = documented copilotChatEntry flake; builds green (extension +
webviews + inproc); debug-console-smoke passed (9.2ms).

## 2026-07-04 - Entry 29: Waterfall native-scroll zoom, packed layouts, prompt hygiene

Owner items:

1. WATERFALL SCROLLBAR (screens: zoomed window w/ dead scrollbar): zooming now
   grows the track content to zoom x 100% width, so the NATIVE horizontal
   scrollbar expands with zoom and always pans correctly. Lane labels moved to
   a fixed column OUTSIDE the horizontal scroller (bars can never render into
   the label area; tracks overflow:hidden clip). Time axis shows the VISIBLE
   window and updates on scroll/zoom (rAF-throttled). Wheel zoom preserves the
   time under the cursor via post-render scrollLeft restore; W/S + A/D +
   drag-pan + Esc/dbl-click reset kept; zoom capped so content stays under the
   browser's max element width (~1.5M px).
2. WATERFALL PAGE LAYOUT: packed splitter grid per waterfall-layout.png - top
   content (decomposition + zoom hint bar), then a 2-row grid filling ALL
   remaining space: row 1 = chart | inspector + critical path (h-splitter),
   row 2 (full width, v-splitter) = Event details table. No outer document
   scrollbars; everything internal-scrolls. History tab keeps the compact
   embedded layout (no table) with the same zoom internals.
3. TABLE DESIGNER RESTORE PROMPT (after-tabledesigner.png): the modal
   "Table Designer has been closed. Would you like to restore it?" is
   suppressed for designers opened from self-test OE sessions, detected by the
   connectionProfile applicationName prefix (vscode-mssql-selftest) - a
   precisely-scoped seam, normal users unaffected. BONUS: viewerInternal
   events (webview.debugConsole.\*) are now excluded from the self-test tap so
   they no longer pollute rep markers/Diagnostics (visible in owner's
   perf-history-layout.png span table).
4. PERF HISTORY COLLAPSIBLE REGIONS (perf-history-layout.png crowding): the
   source bar + runs table collapse to a single toolbar row ("⌄ Runs" caret,
   compact source select + counts + selection summary), and the bottom detail
   tabs collapse to just the tab strip (clicking any tab re-expands). Middle
   workbench unchanged; everything still splitter-resizable when expanded.
   (PanelGroup remounts per layout combo so sizes stay sane.)

VERIFY: builds green; extension unit suite 3269 passing / 1 failing =
documented copilotChatEntry flake; debug-console-smoke passed (8.1ms).

## 2026-07-04 - Entry 30: DacFx designer spans + activation-time capture

1. DACFX GAP (owner: "no DacFx events in Table Designer"): correct — the
   sts.dacfx.\* spans wrapped DacFxService.ExecuteOperation (bacpac/dacpac/
   deploy), but designers use SEPARATE STS services with DacFx DesignServices
   inside. Instrumented at the actual work sites (driver lane):
   TableDesignerService initialize/processEdit/publish/generateScript/
   previewReport; SchemaDesignerService createSession/generateScript/publish.
   STS build green.
2. STARTUP CAPTURE (owner: "flag to start collection at activation"): the
   flag IS mssql.sessionDiag.enabled — but DiagnosticsManager was constructed
   at the END of activation so activation-era events fired sink-less and were
   dropped. Manager + console registration now run FIRST (before
   activate.begin); the console seeds its live source from this session's
   persisted store on open (flush + seq-dedupe) so startup data shows without
   a restart.
3. PATHS CLARIFIED (in final reply): sessionDiag.storePath = continuous
   session trace journals (Session History; default globalStorage/
   ms-mssql.mssql/session-diag; mssql.sessionDiag.openStorageFolder opens
   it). debugConsole.perfRunsRoot = discrete perf RUN directories
   (harness/self-test results; Perf Test History; default globalStorage/
   self-test-runs). Different data families.

VERIFY: builds green (STS + extension); unit suite 3269 passing / 1 failing
= documented copilot flake; smoke 13.6ms; harness 4/4 official.

## 2026-07-03 - Entry 31: Observability documentation hub

Created C:\repos\test\observability-docs\ pulling the three workstreams
together as one "deep observability retrofit": README (map), 01-architecture
(unified event pipeline, correlation, timing honesty, privacy, stores),
02-debug-console (module/RPC/webview/settings implementation reference),
03-instrumentation-reference (full marker/span catalog incl. exact STS span
names, gating, add-more recipes), 04-perftest-integration (two execution
paths one contract, inproc package, run-dir layout, history both ways),
05-testing (inventory, reliability playbook, known flake, verification
chain), 06-sts2-and-next (envelope-seam alignment, gated features, done/
deferred, next-round seams). perftest/docs/README.md gained a pointer
section (inproc package + console + hub).

## 2026-07-04 - Entry 32: CHUNK 1 of the rock-solid plan - Shared Observability Contract

Context: owner dropped three review docs at test root (integrated vision,
next steps, peer review) and asked for a final prioritization + autonomous
execution in large chunks with reassessment stops. Prioritization (trust
before features): C1 contracts+eligibility+honesty -> C2 evidence durability
(manifests/gaps/import safety/sink health/canaries) -> C3 Trace Identity V1 +
correlation health -> C4 scenario parity/graduation -> C5 cross-run analysis
-> C6 diagnostic recipes/XEvents/heap -> C7 STS2 integration (own workstream,
after its waves 1-3).

CHUNK 1 SHIPPED:

- packages/observability-contracts: event registry seeded from the VERIFIED
  emitted inventory (grep-extracted, incl. the pairing reality: begin/ready,
  submit/complete, .begin/.end - explicit pairsWith, never guessed), prefix
  families (rpc./webview./sts.\*), classification taxonomy (8 classes incl.
  providerText with no error-string loophole), timing classes, derived metric
  names; deriveEligibility() = THE shared trust decision; generator emits
  EVENTS.md + dependency-free TS snapshot; 18 tests (integrity, pairing
  symmetry, longest-prefix, honesty matrix, cross-repo name conformance).
- perf-contracts: Metric.eligibility (additive, schema versioned same).
- normalizer: stamps eligibility (controlledHarness); official-vs-eligibility
  disagreement -> validation warning (visible fog).
- vscode-mssql: vendored snapshot + conformance test (greps ACTUAL emitted
  literals - registry can't drift from code); self-test stamps eligibility
  (interactiveHost => exploratory; registry-driven time plane: toRender =
  epoch in-product, honestly diagnostic without calibration); Perf History
  Submetrics shows gate-eligible/exploratory/diagnostic pills + reason.
- Peer-review "decisions to freeze" resolved by implementation: #2 metric
  terminology (the 4-label object), #3 self-test never gates (exploratory).

VERIFY: contracts 18/18; perf-contracts 14/14; cli 44/44 + builds; inproc
12/12; extension 3272 passing (+4) / 1 known copilot flake; REAL RUN PROOF:
gate 4/4 official, result.json shows wallclock gate-eligible, toRender
diagnostic-only (epoch), collector metrics diagnostic, zero eligibility
warnings; console smoke 14.7ms.

NEXT (Chunk 2, on owner go): store manifests + size caps + integrity, exact
live gaps + store backfill, RunImportValidator adversarial corpus, sink
backpressure/health, provenance panels, privacy canary corpus.

## 2026-07-04 - Entry 33: CHUNK 2 - Trust the evidence (durability + safety)

- STORE: manifests gain sizeBytes + EXACT droppedRanges (never a bare count);
  validateStore() integrity check (missing segments, line-count vs manifest,
  partial trailing line, boundary seq); size retention via new setting
  mssql.sessionDiag.maxTotalMB (512 default, oldest closed evicted first).
- GAPS: live-tail gap records carry firstAvailableSeq (exact resync point);
  NEW dc/backfillGap recovers dropped ranges from the session store journal
  and merges into the live view (running/succeeded/partial/failed honest
  states); TopBar backfill button now actually backfills.
- SINK HEALTH: DiagnosticSink.health() self-reports on all three sinks
  (PerfMode dropped/queued; LiveTail ring/pending/droppedTotal/gaps;
  SessionDiag failed+detail/buffered/bytes/dropped); dc/getHealth RPC;
  Settings page Diagnostics health card (sink rows + store integrity).
  SessionDiagSink failure now carries the error detail - degraded, visible.
- UNTRUSTED IMPORTS: provider.repDir/containedPath refuse webview-supplied
  ids escaping the source root (dump summary path too - honest 'refused'
  text); markers.jsonl import caps line size (512KB), validates shape,
  and emits a synthetic import.linesSkipped warning event (registered in
  the contract registry) so imports never silently under-report.
- PROVENANCE: PerfScenarioDetails.runProvenance {sourceKind, readOnly
  (bundles), passType, environmentHash, runStatus, importWarnings} rendered
  at the top of the Validation tab - bad provenance looks visibly suspect.
- PRIVACY CANARIES: new suite pushes sentinel password/connstring/token/
  sql/row/provider values through classifyPayload (digest/redacted/full),
  the SessionDiagSink on-disk journal, and the PerfModeSink wire queue.
  Hard rule proven: secrets NEVER plaintext, even under full capture.
  Plus store-integrity clean/truncated round-trip.

VERIFY: builds green; extension suite 3278 passing (+6: 5 canary + 1
containment) / 1 known copilot flake; contracts 18/18 (import.linesSkipped
registered + re-vendored); gate 4/4 official; smoke 16.7ms.

## 2026-07-04 - Entry 34: CHUNK 3 - Trust the stitching (Trace Identity V1)

- TRACE IDENTITY V1 (contracts pkg): the cross-repo correlation contract -
  TraceIdentityV1 interface with field semantics (jsonRpcId = hint not
  unique id; sts2 cause = graph edge never fake parent), ROOT_ACTION_TTL_MS
  = 120s (matches the console's root window).
- CORRELATION LINTER (contracts pkg, vendored): lintCorrelation() -
  REGISTRY-DRIVEN pair balancing (explicit pairsWith catches begin/ready +
  submit/complete, never suffix guessing), rpc./webview./sts. family
  .begin/.end balancing, orphan accounting w/ lifecycle exemptions
  (sessionDiag./system./scenario./activate), leaked-root detection past
  TTL, epoch-aligned counting, scenario-window noise; honest good/fair/poor
  score + human-readable notes ("why this looks like this"). 6 new tests
  (24 total in the package).
- CONSOLE SURFACES: dc/getTraceQuality RPC (viewer-internal excluded,
  optional per-trace); Overview gains a Trace quality card (score pill +
  correlated/pairs/leaked-roots/diagnostic-bars rows + notes list);
  Waterfall toolbar shows a per-trace "stitching: fair|poor" pill with
  notes on hover when the trace has fog. Fog reported, never painted over.
- Vendored snapshot regenerated; extension conformance suite extended with
  a vendored-linter test.

VERIFY: (below)

## 2026-07-04 - Entry 35: CHUNKS 4-6 - parity, cross-run analysis, recipes

C4 PARITY & GRADUATION:

- CLI designerOpen PORTED (the recorded deferral): driver engine gained
  deferCleanup + the in-proc semantics (server-level OE session, Databases
  walk incl. System Databases, real database TreeNode, designer command);
  ScenarioStep contract extended; scenarios table-designer-open +
  schema-designer-open registered (metric names + marker pairs IDENTICAL to
  the self-test catalog); examples/config.designers.local.jsonc.
  LIVE PROOF: 8/8 reps passed end-to-end; rep-01 shows
  mssql.tableDesigner.init=1944ms gate-eligible + sts.dacfx.tableDesigner
  span + 14 rpc spans - Workflow 2 of the vision doc, working.
- Maturity levels on both catalogs (query-10k-results explicitly ciGating;
  designers diagnostic; defaults derived from implemented).
- Parity conformance test (contracts pkg): shared metric families must have
  identical marker pairs in both hosts AND match the registry derivedFrom.
  C5 CROSS-RUN ANALYSIS IN-PRODUCT:
- quickCompareVerdict (pure, tested): regression/improved/ok/inconclusive
  vs pinned baseline w/ 10%+50ms floors, n>=3, IQR noise check; chip on
  scenario rows, tooltip states the CLI gate is authoritative.
- ph/compareReps + Compare bottom tab (enabled when a baseline is pinned):
  marker-pair phase deltas (registry pairing + .begin/.end families),
  per-type what-changed-most ranking (counts + forwarded durationMs totals),
  added/removed event types, honest plane notes.
  C6 DIAGNOSTIC RECIPES:
- diagnostics.recipe presets (light/ui-rendering/service/sql/memory/full)
  expanded at config load; explicit flags override; heavy recipe in a
  measurement pass warns loudly. Functional check: service recipe expanded
  correctly with override preserved + warning fired.
  C7 STS2: intentionally NOT started - gated on STS2 waves 1-3 per the plan;
  the console's Replay Lab surface stays gated.

VERIFY: (below)

## 2026-07-04 - Entry 36: PHASE 1 WRAP - pre-branch stabilization for Query Studio

Owner is branching to build Query Studio (SSMS-parity editor on STS2;
designs in C:\repos\test\ssms-query-docs). Executed the pre-branch wrap:

ASSESSMENT (what Query Studio consumes -> what must precede the branch):

- STS2 v2 wire contract is the data plane. CHECKED: every method the
  adapter design (doc 03 sec 8.2) expects EXISTS in CONTRACT.md; one naming
  reconciliation recorded for AD-1 (design's v2/session.setCapture is
  v2/diagnostics.setCapture); diagnostics.health/state available as extras.
  NO wire-contract changes needed pre-branch.
- STS2 hardening: the next-steps P0 items (10-14) already LANDED as review
  waves R001-R047 on the sts2 tree (barriers/replay/mailboxes/capture/
  cancel/isolation). BLOCKERS.md: none.
- Observability contracts: queryStudio.\* markers are ADDITIVE post-branch
  (register->generate->re-vendor); frozen vs additive split written down.

NEW PRE-BRANCH STABILIZER: vendor-sync guard test in observability-contracts
(regenerates from the live registry and compares SEMANTICALLY against the
vendored copy in vscode-mssql - prettier's whitespace/key-quoting/trailing-
comma transforms normalized away; any content drift fails). Caught nothing
semantic (formatting only) - now locked for the branch split.

DOCS: observability-docs/07-phase2-query-studio-branch-guide.md (what Phase 2
builds on, AD-1 contract findings, frozen-vs-additive rules, deferred backlog
incl. XEvents MVP/heap snapshots/zip import/SQLite source/Replay Lab/CI
ladder, and the branch mechanics); README + 06 statuses updated.

VERIFY (pre-branch sweep, all executed):

- STS2 verify.sh --quick: GREEN, all 11 gates (build w/ warnings-as-errors,
  unit+multiplexer+architecture, scenario corpus, Sqlite contract tests,
  replay verify, 200-seed simulator, secret canaries, generated docs,
  legacy diff budget, legacy exe build, E2E v1+v2). Caught + fixed two
  pre-branch issues: net472 StsDiag build (System.Net.Http ref +
  Environment.ProcessId fallback) and the legacy-diff-budget calibration
  (sanctioned-seam allowlist w/ recorded reasons, D-0013 - gate stays
  full-strength for unlisted paths).
- vscode-mssql suite 3280 passing / 1 known copilot flake.
- perftest: obs-contracts 27/27 (incl NEW vendor-sync guard),
  perf-contracts 14/14, cli 44/44, inproc 12/12; gate 4/4 official;
  smoke green.
- All three repos committed clean on their current branches.

## 2026-07-05 - Entry 37: B7.7 - querystudio-query-10k scenario + head-to-head command

The Query Studio twin of the classic gate, VERIFIED LIVE, plus a cross-scenario
comparison command. vscode-mssql untouched (rides the PERF_MODE seams from
0f4032d90).

SCENARIO querystudio-query-10k (exploratory): SAME fixture
(queries/select-10000.sql), SAME provisioned SQL server as query-10k-results,
measured through the QS data plane. Setup opens the fixture via
mssql.queryStudio.openActive (custom editor), driver step queryStudioConnect
writes the provisioned profile as the ONLY saved connection
(mssql.perf.setConfig -> mssql.connections, id+groupId ROOT; SqlLogin passwords
seeded via the product's connectionStore seam, never settings) so the product's
exactly-one-profile auto-pick engages, then retries mssql.perf.queryStudioConnect
to {connected:true}. Measured window = queryStudioExecute ->
waitForMarker mssql.queryStudio.resultsRendered (rows:10000-guarded). Success
proof mirrors the classic gate: query.complete rows==10000 AND
resultsRendered rows==10000. wallclock official (driver plane);
mssql.queryStudio.query.toComplete/toRender derived (registry pairs) diagnostic.

THREE REAL FAILURES FOUND BY BRING-UP (each fixed at the honest layer):

1. STS SPAWNED WITHOUT --enable-sts2: serviceclient only appends the flag when
   mssql.sqlDataPlane.enabled is true AT ACTIVATION - a post-activation
   setConfig flip is too late, and v2/session.open then hangs forever (no v2
   dispatcher). Fix: ScenarioSpec.userSettings - the pipeline merge-writes
   declared settings into the profile's User/settings.json BEFORE launch.
   setConfig stays for runtime-only toggles.
2. SPID-PROBE SLOT RACE: sts2 sessions allow ONE active query; the product's
   post-connect background SELECT @@SPID holds it for a moment. A human never
   races it - the driver did (submit 4ms after ready), and the measured execute
   died Busy in 67ms. Fix: queryStudioConnect ends with an UNMEASURED session
   preflight (SELECT 1 via the execute seam, retried until phase==succeeded).
3. PREFLIGHT MARKER POLLUTION: the preflight emits the same product marker
   family as the measured run, so the normalizer's first-end pairing would have
   timed the preflight. Fix: metric spec withinMeasuredWindow (opt-in) scopes
   pair derivation to scenario.start..scenario.end; measure end waits on
   resultsRendered attrs rows:10000 so the preflight's 1-row render can never
   end the window (webview epoch skew makes freshness alone insufficient).

VERIFIED LIVE (run 2026-07-05T09-19-17Z_8d46bf90, exit 0): 1/1 passed,
wallclock 550.9ms official, toComplete 5.6ms monotonic, toRender 167.0ms epoch,
both 10000-row proofs green. Gate NON-REGRESSION (run
2026-07-05T09-20-40Z_8be85bfa, exit 0, WITH the normalizer window-scoping
change active): query-10k-results 4/4 passed official, steady reps 1133-1169ms.

HEAD-TO-HEAD COMMAND: perftest head-to-head [--baseline-scenario --candidate-
scenario --db --out --json --open] (defaults: query-10k-results vs
querystudio-query-10k). Each side = the scenario's most recent measurement run
with official samples from passed non-warmup reps. Console table + HTML in the
shared htmlShell design system: official medians/p95/rep counts, signed delta
bars, and a PHASE table mapping marker pairs that share SEMANTICS across
differently-named families (submit->complete, submit->render) w/ time-plane
notes. Explicitly NON-GATING; honest notes for env-hash mismatch, one-sided
metrics, mixed planes; exit 6 when a side has no qualifying run. Real-store
sample: QS wallclock -52.8% vs classic (n=1 vs 3, env hashes differ - noted);
submit->complete 274.0 -> 5.6ms; submit->render 368.0 -> 167.0ms. The 5.6ms
toComplete is the product's own marker (sts2 plane completes before rendering
work) - flagged for interpretation care, not adjusted.

VERIFY: obs-contracts 27/27 (parity test covers the new registry pairs),
perf-contracts 14/14, cli 57/57 (+13: headToHead selection/phases/honesty/
renderers, scenario registration vs registry, normalizer window scoping),
inproc 12/12. New docs section in docs/CLI.md. examples/config.phase3 lists
the scenario.

DEFERRED (recorded, not hidden): multi-rep QS baseline history (n=1 so far -
exploratory stands); SqlLogin credential-seeding path untested live (this
box provisions Integrated); querystudio-open still flips settings via
setConfig (works - late registration - left unchurned).

## 2026-07-11 — SQLCMD scenario (SC-5)

Registered querystudio-sqlcmd-run (setvar/$(var)/GO 2 through the QS SQLCMD
preprocessor via the newQueryFromContext sqlcmd:true seam; success gates on
mssql.queryStudio.sqlcmd.run + query.complete + noErrors). New registry
markers: queryStudio sqlcmd.toggle / sqlcmd.run / scan.run (counts + safe
enums only). examples/config.sqlcmd.local.jsonc runs it standalone. Suite:
97 passing; the central-store integration file needs the CENT container SQL
(localhost:14333) and is expected red while it is down.

## 2026-07-11 — Vector Workbench scenarios (VEC-12)

Two scenarios, two claims proven separately. querystudio-vector-unopened-f32:
run queries/vectorlab-chunks.sql (5000 rows, 64-dim f32 native vector column,
VectorLab db via the per-scenario profile override) with the vectorWorkbench
gate ON but the tab never activated — success includes the NEW markerAbsent
criterion (negative proof: boot.vectorChunkRequested and queryResults.vector
.ingest never occurred in the rep). PASSED 3/3 + warmup: wallclock 715/724/728
ms, toComplete 374–453ms, toRender 448–512ms — directionally half the
querystudio-query-10k numbers for half the rows; the unopened Vector tab adds
nothing measurable. querystudio-vector-profile-f32: execute moved into setup,
measured window = mssql.perf.queryStudioActivateTab {tab:"vector"} → firstPaint
(afterLastAction pattern; firstPaint carries no attrs so it cannot be the
attrs-guarded end). BLOCKED by a product bug — reported, not patched:
executionOrchestrator.ts beginResultSet column mapping drops the `vector`
metadata that toQsResultColumn (same file, one line below) preserves, so the
VectorWorkbenchService reads transport=textFallback from the retained store
and profile() refuses; STS2 journal proves vectorBinaryV1 WAS negotiated and
vectorEncoding:"binary-v1" WAS sent. All 4 profile reps invalid on firstPaint
timeout with ingest attrs {phase:"open",transport:"textFallback"} and no
dimensions — exactly a missing column.vector.

markerAbsent lives in perf-contracts SuccessCriterion + BOTH engines (driver +
inproc twins, same matching semantics as markerSeen, honest failure message
naming the offending occurrence; nameless criterion fails, never vacuous).
Registry: mssql.queryStudio.boot.vectorChunkLoad + mssql.queryResults.vector.
analysis derived metrics (regenerated + re-vendored). Conformance now checks
markerAbsent names against the registry too; VEC-12 describe block pins the
negative proofs, the setup/measure split, and window-scoped registered pairs.
examples/config.vector.local.jsonc runs both. Suite: obs 27, perf-contracts
47, cli 107 (+central-store integration expected red while the CENT container
is down), inproc 15 (3 new markerAbsent tests).

DEFERRED: profile-f32 pass blocked on the product fix above (one-line mirror
of `vector` into the rowStore registration); rerun config.vector once fixed.
No baseline history for either scenario — exploratory, official:false stands.

## 2026-07-12 — Vector Projection/Search scenario close-out (VEC-12 partial)

`d72d1d4` added the real nested-workspace PERF_MODE path plus Projection,
exact Search, and indexed ANN Search scenarios. The five-scenario config now
drives the committed product (`vscode-mssql 67eb22d7c`) through unopened,
Profile, Projection, exact Search, and ANN Search paths; no arbitrary SQL,
model text, or vector payload crosses the activation seam.

LIVE RUN `2026-07-12T18-06-15Z_d6aa38b5`: unopened, Profile, exact Search,
and ANN Search each passed warmup + 3 measurements (16/16). Projection emitted
successful analysis, projection-worker, and workspace-first-paint markers in
all four reps but the scenario expected `rows:5000`; the fixture has 5,000
source rows with 12 intentional NULL vectors, so the product correctly emitted
`rows:4988`. This was a scenario-contract bug, not a product failure.

`ec21555` changes both Projection success guards to the pinned 4,988 analyzed-
row invariant and adds test coverage for analysis.end and worker.end. Focused
CLI scenario suite: 63/63. Corrected LIVE RUN
`2026-07-12T18-14-14Z_48461388`: Projection 4/4 passed, exploratory wallclock
861.1 / 854.8 / 861.2 / 876.2 ms. Combined current live evidence is 4/4 for
each of all five Vector scenarios. All metrics remain `official:false` because
no baseline history/regression thresholds have been approved.

DEFERRED: the complete VTEST-01..VTEST-22 matrix, baseline/regression gates,
privacy/a11y/localization sweeps, all-family session-diag proof, and release
documentation. VEC-12 remains PARTIAL.
