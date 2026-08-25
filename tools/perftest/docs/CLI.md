# perftest CLI

`packages/perftest-cli` — the orchestrator. Run via
`node packages/perftest-cli/dist/cli.js <command>` (or the `perftest` bin once
linked). Commands and exit codes follow design §26 exactly; they are a public
contract for CI gates.

## Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Run completed, no gated regression                                      |
| 1    | Gated regression found                                                  |
| 2    | Config or schema validation failed                                      |
| 3    | Environment preflight failed                                            |
| 4    | Scenario failed                                                         |
| 5    | Infrastructure or collector failure (also: command not implemented yet) |
| 6    | Insufficient valid samples                                              |

## Commands

### `perftest doctor [--json] [--config <path>]`

Environment preflight (design §13.3). Reports machine identity (hostname, OS,
CPU, memory) and per-check status. Checks that are not implemented yet are
listed as `SKIP` with the milestone they arrive in — the report never
overstates what was verified. With `--config`, additionally validates the
config file. Exits 3 if any check fails.

Current checks: node version, docker availability, dotnet SDK, disk space,
free memory. Arriving later: VS Code resolution (M1), SQL container health,
machine idle, AC power, CPU frequency policy (M4), ETW elevation (M5).

### `perftest schema validate <file> [--contract marker|perf-config|perf-result]`

Validates a JSON/JSONC file against a contract schema. Auto-detects the
contract from the document shape when `--contract` is omitted. Prints each
schema violation; exits 0/2.

### `perftest scenarios list`

Lists the scenario registry with implementation status (`implemented` vs
`planned (M#)`) and each scenario's official metrics.

### `perftest collectors list`

Lists implemented collectors (name, cost class, allowed pass types) and the
planned design-§14.3 catalog separately — never conflating the two.

### `perftest store init [--db <path>]`

Creates/opens the SQLite store and applies the canonical schema
(idempotent). Prints the resulting table/view list.

### `perftest run --config <path> [--scenario <id>] [--pass <type>]`

Loads and schema-validates the config (real today; exit 2 on invalid), then
executes the run pipeline. **Pipeline lands in Milestone 1** — until then the
command reports not-implemented and exits 5 without writing anything.

### `perftest report <runId> [--open]`

Re-renders `report.md`, `report.html`, and the standalone `index.html`
(waterfall + plots) from stored artifacts.

### `perftest compare --current <runId> --baseline <runId|name|rolling:N>`

Official-metrics comparison with the §24 rules. `rolling:N` pools the last N
green runs on the same environment hash (noise-resistant baseline; persisted
as JSON only). Exit 1 on regression, 6 on inconclusive.

### `perftest diff --baseline <runId> --candidate <runId> [--json]`

A/B investigation: the official gate plus non-gating what-changed analysis
(SQL-activity delta headline, cross-signal metric deltas, git context).
Writes `investigation.json` + `investigation.html` beside the candidate run.

### `perftest head-to-head [--baseline-scenario <id>] [--candidate-scenario <id>]`

Cross-SCENARIO comparison (default: `query-10k-results` vs
`querystudio-query-10k`): each side is its scenario's most recent
measurement run with official samples from passed non-warmup reps.
Console table + self-contained HTML (`--out`, `--json`, `--open`):
official medians/p95/rep counts, signed delta bars, and a phase breakdown
mapping marker pairs that share SEMANTICS across differently-named metric
families (submit→complete, submit→render), with time-plane caveats.
Explicitly **non-gating** — different code paths, separately-selected runs.
Exit 6 when either scenario has no qualifying run.

### `perftest trend --scenario <id> [--metric <name>] [--last N] [--tag <t>]`

Cross-run time-series of an official metric: per-run medians, prior-runs
baseline band, and **step-change attribution** (the run + product SHA where
the metric stepped beyond 10%/5-unit thresholds). Writes a self-contained
trend HTML.

### `perftest history [--out history.html] [--open]`

Local dashboard: recent runs (status, tags, environments), per-scenario
trend charts, recent comparison verdicts, named baselines.

### `perftest tag <runId> <label>` · `perftest run … --tag <label>`

Label runs (`before-fix`, `after-fix`, `PR#123`) for filtering in
trend/history.

### `perftest baseline set <name> <runId>` · `perftest baseline list`

Named baselines (bound to the run's environment hash).

### `perftest setup verify` · `scripts/setup-windows.ps1 [-Install]`

Machine validation (§28): toolchain, dotnet diagnostic tools, power/AC
warnings; the script writes `setup-report.json` and can install missing
dotnet global tools with `-Install`.

### `perftest cleanup --older-than <30d|12h> [--keep-regressions] [--dry-run]`

Artifact retention: deletes old run directories, never those referenced by a
regressed comparison when `--keep-regressions` is set.

## Config loading

`--config` files are JSONC (comments + trailing commas allowed). Loading:
parse → schema validation (all errors reported) → `runId: "auto"` resolution →
`sha256` config hash. The raw text is preserved and snapshotted into each run
directory as `run-config.snapshot.json`.

## Logging

Set `PERFTEST_LOG_LEVEL=trace|debug|info|warn|error` to control console
verbosity. During a run, every event (all levels) is also appended to
`perf-runs/<runId>/harness-log.jsonl`. See
[HARNESS_TELEMETRY.md](HARNESS_TELEMETRY.md).
