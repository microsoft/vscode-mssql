# Scenario authoring

A scenario is a complete reproducible experiment (design §7), defined as data
(`ScenarioSpec` in `@mssqlperf/contracts`) and registered in
`packages/perftest-cli/src/scenarios/registry.ts`. The driver extension
executes the steps; the normalizer derives metrics; nothing about a scenario
lives in imperative test code.

## Anatomy

```ts
{
  scenarioId: "query-10k-results",          // stable key; never reuse/rename
  displayName: "Run query with 10000 result rows",
  tags: ["query", "results-grid"],
  profileMode: "warmed",                    // fresh | warmed | reuse
  sql: { connectionProfile: "default", cacheMode: "warm" },
  setup: [ ...steps ],                      // BEFORE the measured interval
  measure: {
    start: { type: "beforeFirstAction" },   // or beforeCommand
    action: [ ...steps ],                   // the measured user action
    end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
    timeoutMs: 120000,
  },
  success: [ ...criteria ],                 // must ALL pass or rep = failed
  cleanup: [ ...steps ],                    // restore state for the next rep
  metrics: [ ...declarations ],             // what the normalizer derives
}
```

## Steps

| Step                               | Semantics                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`                          | `vscode.commands.executeCommand`; await its promise                                                                                             |
| `openDocument`                     | open+show a file (relative to the workspace root)                                                                                               |
| `waitForMarker`                    | semantic wait on any marker (product/STS/webview/driver)                                                                                        |
| `waitForCommandCompletion`         | alias of `command` (kept for spec fidelity)                                                                                                     |
| `mssqlConnect` / `mssqlDisconnect` | non-interactive connect/disconnect of the active editor via the product's test seam                                                             |
| `webviewProbe`                     | live results-grid state via `mssql.perf.gridState`: assert on `rowCount`, `resultSets`, `columns`, `isExecuting`                                |
| `objectExplorerProbe`              | live OE tree state via `mssql.perf.oeSnapshot`: assert on `childCount` of a named node / `expandedNodes`                                        |
| `oeExpand`                         | expand an OE label path (e.g. `["Databases","PerfCatalog","Tables"]`) through the REAL tree provider — product `mssql.oe.expand.*` markers fire |
| `windowFetchCheck`                 | fetch a row window through the real product row path; verify content at the offset (`expectFirstCell`)                                          |
| `completionProbe`                  | invoke the completion provider at the cursor; `expect` must be among the suggestions                                                            |
| `syntheticDelay`                   | gate-proving only (never in product scenarios)                                                                                                  |
| `noop`                             | nothing (harness-loop scenarios)                                                                                                                |

Probe assertions are deliberately tiny: `field op number` with `== != >= <= > <`
— no expressions, no eval. Success-criteria variants of `webviewProbe` /
`objectExplorerProbe` execute the same probes.

There is deliberately **no `sleep` step**. If you need to wait, you must name
the semantic condition you're waiting for. If no marker exists for it, add an
honest one to the product behind `PERF_MODE` (see PRODUCT_INSTRUMENTATION.md).

## The measured interval

- `scenario.start` is emitted immediately before the first action step.
- End `afterLastAction`: `scenario.end` after the last action completes.
- End `waitForMarker`: `scenario.end` when the marker arrives — with a
  freshness guard: only markers timestamped at/after `scenario.start` count,
  so state restored from a previous rep can never fake completion.
- If any measured step fails or times out, **no `scenario.end` is emitted**
  and the rep is `failed`/`invalid` — there is no code path that fabricates
  an end.

## Success criteria

`markerSeen` (name + attrs subset — e.g. `{ rowCount: 10000 }`), `noErrors`
(no step errors recorded in the rep). Prefer **two independent proofs** for
data-shaped claims: query-10k requires the extension-side
`mssql.query.complete {rowCount:10000}` AND the webview-side
`mssql.resultsGrid.renderComplete {rowCount:10000}`.

## Metrics

- `scenario.wallclock` is always derived from `scenario.start`/`scenario.end`
  (same-process monotonic when possible) — declare it `official: true` if the
  scenario is regression-gating.
- Component metrics are declared with `beginMarker`/`endMarker` pairs; the
  normalizer pairs the last begin before the first end, uses monotonic time
  within one process, tags the plane, and records a validation warning (never
  a fake value) if either marker is missing.
- Anything not derived from markers is `official: false`, full stop.

## Determinism checklist for new scenarios

1. Setup puts every dependency in a known state (activation done, document
   open, connection established) _outside_ the measured window.
2. Cleanup restores anything the scenario changed that window-restore would
   replay (e.g. focused view — see the activation scenario's Explorer reset).
3. Warmed profiles share `vscode-user-data` across reps; account for what VS
   Code restores at launch.
4. Success is proven semantically, from data the product actually produced.
5. Timeouts generous enough for first-run costs (STS download), tight enough
   to fail meaningfully.
