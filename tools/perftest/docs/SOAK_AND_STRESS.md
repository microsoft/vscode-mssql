# Soak / stress / reliability testing

Phase-2 M10: run an action in a long loop inside one measured window and
analyze latency drift, reliability, and memory growth over iterations. This is
a first-class scenario shape (contract + analysis + artifacts), not a script.

## The `loop` block (ScenarioSpec)

```ts
loop: {
  iterations: 1000,          // PERF_SOAK_ITERATIONS env (via config) overrides
  warmupIterations: 5,       // recorded, excluded from steady-state analysis
  onFailure: "continue",     // reliability runs capture EVERY failure
  steps: [ ...ScenarioStep[] ],
  success: [ ...criteria ],  // per-iteration, freshness-scoped to the iteration
  settleSteps: [ ... ],      // between iterations, outside iteration timing
}
```

- The driver emits `iteration.start`/`iteration.end` markers with
  `attrs.index/warmup/status/errorKind`; `waitForMarker` steps and
  `markerSeen` criteria inside an iteration only accept markers timestamped
  within that iteration — iteration N can never pass on iteration N−1's data.
- Failures are classified (connect / query / disconnect / timeout /
  verification / other), recorded, and the loop continues or aborts per
  policy. Nothing is retried or hidden.
- The reference scenario is `soak-connect-query-disconnect`: per iteration
  connect → run the 10k query → prove `rowCount == 10000` → disconnect
  (all through real product paths).

## Outputs

- `soak-iterations.jsonl` — every iteration record (index, warmup, status,
  durationMs, errorKind, timestamps). `result.json` carries summaries only
  (additive contract).
- Marker-plane memory timeline: the driver samples `process.memoryUsage()`
  (exthost rss/heapUsed) as counter markers every 500 ms during the window.

## Analysis (`src/regression/soakAnalysis.ts`, unit-tested)

| Metric                         | Meaning                                                                  | Official-eligible      |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------- |
| `soak.latency.p50` / `p95`     | steady-state iteration latency                                           | yes (measurement pass) |
| `soak.latency.slope`           | ms/iteration drift (OLS slope + 95% CI)                                  | yes                    |
| `soak.reliability.failureRate` | real failure count / steady iterations (+ taxonomy, first-failure index) | yes                    |
| `soak.memory.rssSlope`         | bytes/iteration over steady state (+ CI, R², samples, verdict)           | yes                    |
| `soak.memory.totalGrowth`      | first→last RSS delta                                                     | diagnostic             |

**Leak verdicts are the #1 fabrication risk and are handled accordingly**:
every verdict resolves to `stable | growing | inconclusive` with the slope,
95% CI, R², and sample count attached and a human-readable reason. Thin data
(< 20 steady-state samples) or a CI straddling the stability threshold is
`inconclusive` — never "no leak". Warmup iterations are excluded from the fit.

Gate-proof hooks (recorded transparently on markers, config-snapshotted):
`PERF_SYNTHETIC_LEAK_KB_PER_ITER` retains real memory per iteration;
`PERF_SOAK_ITERATIONS` scales the loop.

## First real finding (2026-07-01)

A 60-iteration connect→query→disconnect soak (run
`2026-07-02T05-36-59Z_09ed4020`) showed **extension-host RSS growing ~567
KB/iteration (95.7 MB total), verdict `growing`** (CI lower bound 276 KB/iter;
R² 0.20 noted in the reason), with latency flat and zero failures. Candidate
explanations: per-query result/history retention in the extension host, or
lazily-collected V8 heap. Follow-up: longer run + M10.5 heap snapshots to
attribute top growth.
