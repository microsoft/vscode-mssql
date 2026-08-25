# vscode-mssql instrumentation (PERF_MODE)

What the perf harness adds inside the product extension, where, and the rules
that keep it invisible outside perf runs. Product changes live on branch
`dev/karlb/perftest` of `vscode-mssql`; all paths below are relative to
`extensions/mssql/`.

## The gate

Everything hangs off one check, resolved once at module load in
`src/perf/perfTelemetry.ts`:

```ts
process.env.PERF_MODE === "1"; // and PERF_MARKER_URL + PERF_CONTROL_TOKEN present
```

Outside perf mode `Perf` is a frozen no-op object — every call site costs one
inert function call, no sockets, no timers, no state, no registered commands.
There is no configuration surface, no settings key, and no way to enable it
from inside VS Code; only the orchestrator's environment enables it.

## Modules added

| File                        | Purpose                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/perf/perfTelemetry.ts` | `Perf` singleton: marker emission (bounded queue → async HTTP POST to the orchestrator's marker sink), activation state, STS PID tracking |
| `src/perf/perfApi.ts`       | Perf-only API (design §16.3 subset): the `mssql.perf.getState` command, registered only in perf mode                                      |

Marker delivery rules (design §10): bounded queue (1000, drop-oldest with a
drop counter), 250 ms batched flush over `http.request` to `PERF_MARKER_URL`
(127.0.0.1) with the run token, 2 s timeout, `unref`'d timer, every path
wrapped so instrumentation can never throw into or block the product.

## Integration points (the entire product diff)

| Site                                                                            | Change                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` `activate()` first line                                      | `mssql.activate.begin` marker + state `activating`                                                                                                                                                                      |
| `src/extension.ts` after the last awaited init                                  | `mssql.activate.end` marker + state `activated`, perf API registration, flush                                                                                                                                           |
| `src/controllers/mainController.ts` `registerCommand`/`registerCommandWithArgs` | `mssql.command.invoked` (instant) with the command id at dispatch                                                                                                                                                       |
| `src/languageservice/serviceclient.ts` `initializeLanguageClient`               | `mssql.sts.spawn.begin` before client creation; after `client.start()`: `mssql.sts.spawn.end` + `mssql.sts.ready` with `attrs.pid` from the public `LanguageClient.serverProcess` getter, PID recorded for the perf API |

### Why command _durations_ are not marked here

`registerCommand` dispatches through an internal `EventEmitter`; handler
promises are detached, so no honest end-of-command signal exists at that seam.
We emit the instant dispatch marker only. Durations come from semantic
markers at real completion points (activation end, connection ready, results
render) — never from a seam that can't observe completion.

### Known quirk

`mssql.sts.spawn.begin` can fire twice when the service resolution retries
(e.g. first-run download path). Marker-pair metrics currently pair the first
begin with the first end; treat `extension.stsSpawn` as diagnostic
(`official: false`) — which it is.

## Perf-only API

`vscode.commands.executeCommand("mssql.perf.getState")` (perf mode only) returns:

```ts
{
  perfMode: true,
  activationState: "inactive" | "activating" | "activated" | "failed",
  extensionHostPid: number,
  stsPid?: number,
  markersQueued: number,
  markersDropped: number,
}
```

The driver extension is the only intended caller. The command does not exist
outside perf mode (nothing is registered), so it cannot leak into the product
surface.

## Markers emitted (M2 set)

| Marker                                          | Phase     | When                                                       |
| ----------------------------------------------- | --------- | ---------------------------------------------------------- |
| `mssql.activate.begin` / `mssql.activate.end`   | begin/end | First line of `activate()` / after last awaited init       |
| `mssql.command.invoked`                         | instant   | Any registered mssql command dispatch (attrs.command)      |
| `mssql.sts.spawn.begin` / `mssql.sts.spawn.end` | begin/end | Around STS LanguageClient creation+start (end carries pid) |
| `mssql.sts.ready`                               | instant   | STS accepting RPC (client.start() resolved)                |

M4′ added: `mssql.connection.begin/ready`, `mssql.query.submit/complete`
(rowCount/hasError attrs), the webview mark bridge and
`mssql.resultsGrid.renderComplete`.

Phase 3 added:

| Marker                                    | Where                                         | Attrs                                                                                |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `mssql.oe.expand.begin/end`               | `objectExplorerService.expandNode`            | nodePath, nodeType, childCount (end), error                                          |
| `mssql.resultsGrid.windowFetch.begin/end` | `queryResult/utils.ts` GetRowsRequest handler | batchId, resultId, rowStart, numberOfRows/rowsReturned — the virtual-windowing proof |
| `mssql.query.cancelled`                   | `queryRunner.cancel` success path             | messages                                                                             |

Phase 3 perf-only probe commands (registered by `registerPerfApi`, PERF_MODE
only): `mssql.perf.gridState` (result-set rowCounts/columnCounts/isExecuting),
`mssql.perf.gridFetchWindow` (a real row-path window fetch for offset
correctness checks), `mssql.perf.oeSnapshot` (expanded-node child counts).
These reach internals through any-casts by design — sanctioned, gated test
seams like `mssql.getControllerForTests`.

## Zero-behavior-change verification

Checklist run whenever product instrumentation changes (results recorded in
PROGRESS.md):

1. `npm run build` clean on the product repo.
2. Every new call site goes through the `Perf` no-op gate (review the diff:
   the only unconditional code is `import` + no-op calls).
3. Runtime check: launch VS Code with the built extension and **no** perf env
   vars, alongside a control server on a known port that is _not_ advertised
   to the process — verify zero connections/marker POSTs arrive and the
   extension activates normally.
