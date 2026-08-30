# perftest documentation

Implementation documentation for the MSSQL VS Code performance harness. The
historical design lived outside the imported repository at
the historical perf-system design, which is not imported into this repository.
These documents describe what is actually **built**, how to use it, and where it
deliberately diverges from or extends that design. See [`../UPSTREAM.md`](../UPSTREAM.md)
for import provenance and current migration policy.

## Index

| Document                                       | Covers                                                                                         | Since |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| [CONTRACTS.md](CONTRACTS.md)                   | Marker / result / config schemas, control messages, identity & time model, SQLite store schema | M0    |
| [CLI.md](CLI.md)                               | `perftest` command surface, exit codes, config loading                                         | M0    |
| [HARNESS_TELEMETRY.md](HARNESS_TELEMETRY.md)   | The harness's own structured logging & spans — how to trace the harness itself                 | M0    |
| ARCHITECTURE.md                                | Control plane, launch, lifecycle, marker pipeline (end-to-end loop)                            | M1    |
| RUNNING_TESTS.md                               | How to run scenarios, read run output, interpret results                                       | M1    |
| PRODUCT_INSTRUMENTATION.md                     | `PERF_MODE` instrumentation inside vscode-mssql                                                | M2    |
| SCENARIO_AUTHORING.md                          | Writing new scenarios: steps, success criteria, metrics                                        | M4′   |
| SQL_PROVISIONING.md                            | SQL container/seed/snapshot strategy, external provider                                        | M4′   |
| REGRESSION_MODEL.md                            | Aggregation, invalid-run rules, thresholds, verdicts                                           | M6′   |
| REPORTS.md                                     | Console/Markdown/HTML reports                                                                  | M6′   |
| STS_INSTRUMENTATION.md                         | STS diagnostics built on the sts2 envelope/journal seams                                       | M3    |
| DIAGNOSTIC_COLLECTORS.md                       | CDP, dotnet-counters/trace, WPR/ETW, XEvents collectors                                        | M5    |
| [SOAK_AND_STRESS.md](SOAK_AND_STRESS.md)       | Loop scenarios, leak/reliability analysis, verdict honesty                                     | M10   |
| [INVESTIGATION_DIFF.md](INVESTIGATION_DIFF.md) | A/B what-changed diffs (SQL activity, cross-signal metrics)                                    | M11   |

## Related: the in-product surface and the observability hub

The MSSQL Debug Console (in `vscode-mssql`) is the in-product companion to
this harness: it browses the same run-directory contract (Perf Test History),
runs the same scenario shapes in-place (self-test via
`packages/perftest-inproc`), and receives forwarded `rpc.*`/`webview.*`/`sts.*`
diagnostic spans inside PERF_MODE runs (additive to the marker contract;
never official). The original standalone checkout also referenced external
cross-cutting `observability-docs`; those files were not part of the tracked
perftest import. The `perftest-inproc` package (scenario engine, marker bus,
runner, self-test catalog) ships here under `packages/`.

## System in one paragraph

The `perftest` CLI loads a schema-validated config, runs environment preflight,
provisions SQL state, launches a pinned VS Code build **unforked** with fresh
profile directories and only two extensions (the product `ms-mssql.mssql` and the
`mssql-perf-driver` automation extension), and starts a localhost WebSocket control
server. The driver authenticates with a one-time token, calibrates clocks, and
executes scenario steps using VS Code commands and semantic waits — never sleeps,
never pixel-clicking. Every process emits **markers** (append-only semantic events);
the official metric of every scenario is derived only from markers. The normalizer
turns markers into a schema-valid `result.json` per repetition, rows land in a local
SQLite store keyed by an environment hash, and the regression engine compares
distributions against baselines with both percent and absolute-floor thresholds.
Diagnostic passes can attach heavy collectors (CDP profiles, dotnet-trace, ETW,
SQL XEvents, sts2 envelope journals) which explain regressions but are never
allowed to become official numbers.
