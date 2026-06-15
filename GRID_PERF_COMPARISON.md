# Query Result Grid Performance Comparison

This report compares the legacy query result grid against the BetaGrid path using the Playwright benchmark added under `extensions/mssql/test/perf`.

## Run Context

- Run date: 2026-06-15
- VS Code target: Insiders. Stable was blocked locally by a VS Code updater mutex during test launch.
- Command: `VS_CODE_VERSION_NAME=insiders npm run perf:grid`
- Scenarios: `small`, `vertical`, `wide`, `heavy`, `streaming`
- Raw reports:
    - `extensions/mssql/test-results/queryResultGridBenchmark-Q-6de74-hmark-legacy-grid-scenarios/grid-perf-legacy-summary.json`
    - `extensions/mssql/test-results/queryResultGridBenchmark-Q-f9586-nchmark-beta-grid-scenarios/grid-perf-beta-summary.json`

Lower values are better for all timing columns. The result is a single local run, so treat it as directional until repeated across several runs.

## Executive Summary

BetaGrid wins the user-visible rendering path in every tested scenario. It reaches first data paint 13% to 61% faster than the legacy grid, with the largest gains in wide and heavy-cell cases.

Legacy grid wins the raw `GetRowsRequest` p95 timing. This is not a pure apples-to-apples throughput result: the legacy grid issues many more smaller fetches, while BetaGrid issues far fewer larger windowed fetches. From a user perspective, BetaGrid still paints data sooner despite slower per-call fetch p95.

Scripted scroll performance was effectively tied. Both grids stayed around a 16.8 ms p95 frame gap with 0% dropped frames in vertical and horizontal scroll scenarios.

The current `streaming` scenario exercises large-result fetch and render behavior, but it did not produce `row-count-change` events in this run. A separate intentionally delayed/chunked query or service-level mock would be needed to isolate incremental "new data arrived" paint timing.

## Rendering Performance

`mountFirstPaint` measures grid mount to first paint. `firstDataPaint` measures grid mount to first visible data paint.

| Scenario  |        Shape | Legacy mount first paint | Beta mount first paint | Beta change | Legacy first data paint | Beta first data paint | Beta change |
| --------- | -----------: | -----------------------: | ---------------------: | ----------: | ----------------------: | --------------------: | ----------: |
| small     |   1,000 x 10 |                  35.0 ms |                30.3 ms |      -13.4% |                 91.4 ms |               75.7 ms |      -17.2% |
| vertical  | 100,000 x 12 |                  25.4 ms |                15.6 ms |      -38.6% |                 61.8 ms |               37.3 ms |      -39.6% |
| wide      |  10,000 x 80 |                  43.5 ms |                18.5 ms |      -57.5% |                111.1 ms |               44.2 ms |      -60.2% |
| heavy     |  25,000 x 20 |                  37.1 ms |                16.1 ms |      -56.6% |                 72.9 ms |               28.4 ms |      -61.0% |
| streaming |  200,000 x 8 |                  22.0 ms |                16.5 ms |      -25.0% |                 59.0 ms |               51.2 ms |      -13.2% |

Meaningful takeaways:

- BetaGrid's strongest advantage is initial usability: users see rows sooner across all tested data shapes.
- The wide and heavy scenarios are the most relevant wins because they stress layout, cell formatting, and column sizing more than the simple small grid.
- The streaming scenario still favors BetaGrid, but by a smaller margin; this should be revisited with a scenario that guarantees incremental result-set updates.

## Fetch Behavior

`getRows p95` measures the extension RPC duration for row fetches. This is useful, but it should be interpreted with fetch count and returned-row shape.

| Scenario  | Legacy getRows p95 | Beta getRows p95 | Legacy calls | Beta calls | Legacy fetched rows recorded | Beta fetched rows recorded |
| --------- | -----------------: | ---------------: | -----------: | ---------: | ---------------------------: | -------------------------: |
| small     |            51.7 ms |          75.9 ms |           20 |          6 |                           50 |                        300 |
| vertical  |            10.1 ms |          35.4 ms |          242 |          5 |                            1 |                        103 |
| wide      |            41.5 ms |          53.1 ms |          242 |          5 |                            1 |                        103 |
| heavy     |            19.5 ms |          52.6 ms |          242 |          5 |                            1 |                        103 |
| streaming |             6.2 ms |          43.9 ms |          242 |          5 |                            1 |                        103 |

Meaningful takeaways:

- Legacy performs many small fetches. Its p95 per call is lower, but it makes far more calls during the same scenario.
- BetaGrid performs fewer larger windowed fetches. Its per-call p95 is higher, but the grid still reaches first data paint faster.
- The `fetchedRows` values are useful as instrumentation signals, not complete row-count totals. They reflect recorded response-paint events, and the two grids currently record those events at different points in their fetch pipelines.

## Scrolling Performance

The benchmark drives deterministic vertical scrolling in every scenario and horizontal scrolling in `wide` and `heavy`.

| Scenario  | Legacy vertical p95 frame gap | Beta vertical p95 frame gap | Legacy dropped frames | Beta dropped frames |
| --------- | ----------------------------: | --------------------------: | --------------------: | ------------------: |
| small     |                       16.8 ms |                     16.8 ms |                  0.0% |                0.0% |
| vertical  |                       16.8 ms |                     16.8 ms |                  0.0% |                0.0% |
| wide      |                       16.8 ms |                     16.8 ms |                  0.0% |                0.0% |
| heavy     |                       16.8 ms |                     16.8 ms |                  0.0% |                0.0% |
| streaming |                       16.8 ms |                     16.8 ms |                  0.0% |                0.0% |

| Scenario | Legacy horizontal p95 frame gap | Beta horizontal p95 frame gap | Legacy dropped frames | Beta dropped frames |
| -------- | ------------------------------: | ----------------------------: | --------------------: | ------------------: |
| wide     |                         16.8 ms |                       16.8 ms |                  0.0% |                0.0% |
| heavy    |                         16.8 ms |                       16.8 ms |                  0.0% |                0.0% |

Meaningful takeaways:

- The scripted scroll path does not show a practical difference between grids.
- Both implementations held the expected ~60 FPS frame cadence in this local run.
- If scroll smoothness becomes a product concern, add a browser trace or wheel-input scenario; direct `scrollTop` updates are stable and repeatable, but they may not expose all user-input costs.

## New Data / Streaming Behavior

The `streaming` scenario uses 200,000 rows to exercise large-result behavior. In this run:

| Grid     | firstDataPaint | getRows p95 | rowCountChange events | rowCountChangePaint events |
| -------- | -------------: | ----------: | --------------------: | -------------------------: |
| Legacy   |        59.0 ms |      6.2 ms |                     0 |                          0 |
| BetaGrid |        51.2 ms |     43.9 ms |                     0 |                          0 |

Meaningful takeaways:

- BetaGrid paints first data faster in the large-result scenario.
- This run did not validate incremental row-count repaint behavior because no row-count change events were emitted.
- To measure "new data arrives while the grid is open" more directly, add a scenario that forces incremental service updates, for example a delayed/chunked SQL workload, a temp table populated in batches, or a mocked result service that emits row-count changes deterministically.

## Recommendation

Based on this run, BetaGrid is ahead on the most user-visible metric: time to first visible rows. It is especially strong for wide and heavy data, which are the scenarios most likely to make a grid feel slow.

Before using these numbers as release evidence, run the benchmark multiple times and compare medians. The next benchmark improvement should target incremental new-data behavior, since the current service/query combination did not trigger row-count update paint events.
