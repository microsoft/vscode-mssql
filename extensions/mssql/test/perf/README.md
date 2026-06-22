# Query Result Grid Benchmarks

These Playwright benchmarks compare the legacy query result grid with the BetaGrid path selected by `mssql.preview.betaResultsGrid`.

## Prerequisites

`npm run perf:grid` rebuilds the extension and webview bundles before launching Playwright so the benchmark runs against the current source.

Create `extensions/mssql/test/e2e/.env` using the same connection variables as the e2e tests:

```env
VS_CODE_VERSION_NAME=stable
SERVER_NAME=(localdb)\MSSqlLocalDb
AUTHENTICATION_TYPE=Integrated
PROFILE_NAME=grid-perf
```

## Run

From `extensions/mssql`:

```shell
npm run perf:grid
```

The benchmark launches VS Code twice: once with `mssql.preview.betaResultsGrid=false` and once with it set to `true`. It enables the hidden `mssql.dev.gridPerfTelemetry` setting only for the benchmark session.

Reports are written under Playwright's test output folders and attached as JSON. A run also writes `test-reports/grid-perf/playwright-results.json`.

## Scenarios

Default scenarios:

- `small`: 1,000 rows x 10 columns.
- `vertical`: 100,000 rows x 12 columns.
- `wide`: 10,000 rows x 80 columns.
- `heavy`: 25,000 rows x 20 columns with JSON/XML/long/null-like cells.
- `streaming`: 200,000 rows x 8 columns to exercise large-result fetches and row-count update timing when incremental updates are emitted.

Optional scenario:

- `multi`: two result sets, one small and one larger.

Select scenarios:

```shell
$env:MSSQL_GRID_PERF_SCENARIOS = "small,vertical,multi"
npm run perf:grid
```

Useful knobs:

```shell
$env:MSSQL_GRID_PERF_VERTICAL_ROWS = "50000"
$env:MSSQL_GRID_PERF_STREAMING_ROWS = "100000"
$env:MSSQL_GRID_PERF_WIDE_COLUMNS = "120"
$env:MSSQL_GRID_PERF_SCROLL_STEPS = "100"
$env:MSSQL_GRID_PERF_SCROLL_DURATION_MS = "5000"
npm run perf:grid
```

## Metrics

Each JSON report includes:

- `getRows`: host fetch duration for `GetRowsRequest`.
- `mountFirstPaint`: grid mount to first paint.
- `firstDataPaint`: grid mount to first visible data paint.
- `getRowsResponsePaint`: fetch response to painted rows.
- `requestedRows`: total rows requested across `GetRowsRequest` calls.
- `paintedResponseRows`: rows represented by response-to-paint events; useful for paint instrumentation, not total fetch volume.
- `rowCountChangePaint`: row-count update to paint, when the SQL tools service emits incremental result-set updates.
- `scroll.vertical` / `scroll.horizontal`: p50/p95/max frame gaps and dropped-frame percentage during scripted scrolling.
