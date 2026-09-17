# Running perf tests

## Prerequisites

- Node ≥ 22 (Node 24 LTS recommended), npm.
- `npm install && npm run build` in `tools/perftest`.
- `perftest doctor` should pass (Docker/dotnet are warnings unless you run
  SQL/STS scenarios).
- First run downloads the pinned VS Code build into `.vscode-test/` (cached
  afterwards).

## Running

Config paths resolve relative to the config file, while harness-owned SQL and
collector assets resolve from `tools/perftest`. Either invocation below works:

```powershell
# Everything in a config
npm run perftest -- run --config examples/config.noop.local.jsonc

# Or, from the vscode-mssql repository root:
npm --prefix tools/perftest run perftest -- run --config examples/config.noop.local.jsonc

# One scenario from the config
npm run perftest -- run --config examples/config.noop.local.jsonc --scenario noop

# Diagnostic pass (heavier collectors when configured; metrics never official)
npm run perftest -- run --config <cfg> --pass diagnostic
```

During the run, VS Code windows will open and close on the desktop — one per
repetition. Don't interact with them; the machine should otherwise be idle for
measurement passes.

## Reading the output

Console summary at the end:

```text
Run: 2026-07-01T19-xx-xxZ_ab12cd34
  noop rep 0: passed scenario.wallclock=8.3ms (official=true)
  noop rep 1: passed scenario.wallclock=7.9ms (official=true)
Report: perf-runs\<runId>\report.md
```

Per run directory (full layout in [ARCHITECTURE.md](ARCHITECTURE.md)):

- `report.md` — human summary: per-rep table, medians, validation notes,
  artifact links.
- `summary.json` — machine summary for scripts/agents.
- `scenarios/<id>/reps/rep-NN/result.json` — the canonical per-rep contract.
  `status` + `metrics[]` + `validations[]` tell the whole story of a rep.
- `scenarios/<id>/reps/rep-NN/markers.jsonl` — the raw semantic events; the
  official wallclock is derived from `scenario.start`/`scenario.end` here.
- `harness-log.jsonl` — the harness's own structured trace (see
  [HARNESS_TELEMETRY.md](HARNESS_TELEMETRY.md)); first stop when a run
  misbehaves.

Everything is also in SQLite (`perf.db`) — the `official_metric_samples` view
is the regression-eligible dataset.

## Exit codes

`0` clean · `1` gated regression (M6′) · `2` bad config/schema ·
`3` preflight failed · `4` a scenario failed · `5` infrastructure failure ·
`6` no valid samples. Full table in [CLI.md](CLI.md).

## Interpreting rep status

- **passed** — success criteria proven; timing is regression-eligible
  (`official: true` in a measurement pass).
- **failed** — the scenario ran but couldn't prove success (or a step
  failed). Timing may exist but is never official.
- **invalid** — the rep can't be trusted at all (missing required markers,
  driver never connected, infrastructure broke). Excluded from everything.

## Troubleshooting

| Symptom                                     | Where to look                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rep invalid, "no scenario outcome received" | `artifacts/vscode-stderr.log`, then `harness-log.jsonl` for the control-server events                                                                                          |
| Driver never connects                       | Was the extension built? (`npm run build`) — the pipeline checks `main` exists but stale builds can still misbehave; check `vscode-stdout.log` for `[mssql-perf-driver]` lines |
| Marker rejected warnings                    | `markerSinkClean` validation in `result.json` lists the count; the harness log has the schema errors                                                                           |
| VS Code had to be force-killed              | `vscode.killTree` events in the harness log; look for hung dialogs on the desktop                                                                                              |
