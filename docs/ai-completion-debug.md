# AI completion debugging (private preview)

This change brings the completion viewer from `dev/refactor` at `239fa6acc`
into the Debug Console and AI completion preview. The work originally reviewed in
PRs #22835 (Debug Console), #22863 (AI completions), #23114 (completion debugging),
and #23126 (Connections v2 UI parity) is now delivered together against `main`.
These features have been exercised as one integrated experience; the combined
change removes the temporary PR base and merge-order requirements.

## Enable and open

Set these in **User settings**, then reload the Extension Development Host.
These application-scoped flags do not take effect in workspace settings:

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.debugConsole.enabled": true,
    "mssql.copilot.inlineCompletions.enabled": true
}
```

Run **MS SQL: Open Debug Console**, then select **Completions**. The console
starts on **Consolidated Trace**. All preview flags default to off.

The integrated page keeps the console's navigation and session toolbar visible.
When completions are enabled, the Live/Sessions tools fill the page; setup guidance
is shown only while the feature is disabled. Live records events while the viewer
is open. Use **Record closed** to retain live events after closing it, or enable
trace collection on **Sessions** for saved captures. Expand the trace-file list,
choose **Add** on a capture, then open **Replay** and **Matrix...** to configure
profile/schema experiments.

The Live view shows completion requests, outcomes, prompts, model responses,
timings, and acceptance. Profile, model, schema, prompt, and debounce controls
apply session overrides. Editing unrelated controls preserves schema and category
opt-outs. Models come from the current VS Code language-model catalog; completion
profile preferences and explicit model settings remain authoritative.

The Sessions view loads saved traces and supports importing files, selecting
events, assembling replay runs, and comparing profile/schema experiments.
Replays call the selected language model; they do not execute the generated SQL.
Feature disablement cancels active replays and prevents further model requests.

## Connections v2

To test the Connections (Private Preview) view alongside completion debugging,
also enable `mssql.sqlDataPlane.enabled` and `mssql.objectExplorer.v2.enabled`
before reloading. The existing experimental-features setting above is required.

The view shares classic Object Explorer's Getting Started page and hide/show
preference, toolbar actions and icons, and default group expansion. The existing
`mssql.objectExplorer.collapseConnectionGroupsOnStartup` setting still overrides
the expanded default. Saved server connections remain collapsed. Native query
and scripting commands are available with the separate [Query Studio preview](query-studio.md);
existing administration commands retain their classic connection bridge.

## Capture and privacy

Opening the viewer enables its in-memory capture. To retain events while it is
closed, set `mssql.copilot.inlineCompletions.debug.recordWhenClosed` to `true`.
For durable traces, enable `mssql.copilot.inlineCompletions.trace.captureEnabled`
or use the Sessions capture controls. These settings are independently off by
default. Schema sharing remains a separate opt-in through
`mssql.copilot.inlineCompletions.useSchemaContext`.

Disk traces honor `trace.redactPrompts` (on by default) and the existing size and
retention limits. Explicit exports also honor redaction. Raw in-memory details and
explicit clipboard copies can contain SQL and schema context. Imports reject files
over 64 MB and validate trace records before using them.

Capture uses an append-only journal under the extension's global storage
`completion-debug` directory, alongside the existing trace-file workflow. The
experimental `mssql.copilot.inlineCompletions.trace.journalPrimary` setting selects
journal-derived saves, with fallback to the existing trace save if necessary.
It defaults to off. Completion journals and replay records have their own catalog;
they are not part of the general Debug Console session-retention policy in this
extraction.

## Extraction boundary

Included: the integrated Completions page, shared command/state services, capture journals,
saved completion sessions, replay queues/matrices, trace analysis, model/settings
experiments, and the Connections v2 parity improvements above. Cancellation,
privacy, schema, and model fixes from the original PRs are retained, including
context-aware identifier spacing and duplicate-dot handling in live completion
and replay.

Deferred: Query Studio, native scripting/query commands, generic cross-feature
Replay Lab pages, central upload, and the general session-bundle integration. The
existing Connections v2 boundary is unchanged. The debug-console performance
scenario now seeds its preview settings before activation.

The classic grid/window and Object Explorer performance probes are also restored
from the refactor under `PERF_MODE=1`, together with OE expansion and query-cancel
markers. The probes are unavailable in ordinary extension sessions. This lets the
existing performance scenarios assert actual product row and child counts.

Validation uses the combined tree: extension/toolkit unit tests, repository tests,
the performance harness suites (including a disposable local SQL integration
database), editor/grid tests, and live classic-query/OE performance scenarios.
Single-repetition diagnostic runs verify operation; they do not establish a
performance regression baseline. Exact results and any outstanding failures are
recorded in the PR description.
