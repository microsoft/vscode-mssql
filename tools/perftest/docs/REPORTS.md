# Reports

Every run renders three views of the same data (design §27); all of them are
generated from `result.json` files and the SQLite store — never from private
state, so they can always be regenerated (`perftest report <runId>`).

## Console summary

Printed at the end of `perftest run`: per-rep status + official wallclock,
then (when a baseline is configured) the comparison table:

```text
Run: 2026-07-02T04-xx-xxZ_ab12cd34
  noop rep 0: passed scenario.wallclock=0.5ms (official=true)
  ...
Current:  2026-07-02T04-xx...   Baseline: 2026-07-02T03-xx...
Status:   REGRESSED
Scenario   Metric              Current   Baseline   Delta    Verdict
noop       scenario.wallclock  250.9 ms  0.5 ms     +49k%    REGRESSED
```

## report.md (per run directory)

Run metadata, environment hash, per-scenario rep tables (status, wallclock,
official flag, links to each `result.json`), pass/median/min/max summary
line, validation notes (anything failed/warning), artifact index.

## report.html (per run directory)

Self-contained static HTML (no external assets — zip the run folder and it
still renders). Same content as report.md plus the baseline-comparison table
with verdict coloring and per-metric reasons (`src/report/htmlReport.ts`).

## comparison.json (per run directory)

The machine-readable comparison (same data as the console/HTML tables):
per-metric-key summaries of both distributions, deltas, p-values, thresholds
used, verdicts, and the run-level status. CI and agents should consume this,
not parse the console output. Also persisted to the `comparisons` /
`comparison_metrics` tables.

## index.html (per run directory — the primary report)

Benchmark-report-grade standalone page (design system + inline SVG, zero
external fetches): KPI tiles, the **cross-process waterfall** (solid bars =
official same-process monotonic intervals; dashed = epoch-aligned diagnostic
intervals, calibration jitter in the legend; SQL Server lane labeled as the
server's own clock), per-scenario wallclock distributions, soak latency/RSS
trends with fitted slope + CI band + verdict, SQL top-N by duration, rep
tables, validation notes, environment, artifact index.

## Cross-run pages

- `perftest trend --scenario <id> --metric <name>` → trend HTML with the
  prior-runs baseline band and step-change attribution (run + product SHA).
- `perftest history` → `history.html`: recent runs (status/tags/environments),
  per-scenario trend charts, comparison verdicts, named baselines.
- `perftest diff … ` → `investigation.html` (gate + SQL-activity delta).

## Regenerating

```powershell
node packages/perftest-cli/dist/cli.js report <runId> [--open]
```

Reads rep `result.json` files + artifacts from the run's stored output dir
and rewrites report.md/report.html/index.html.
