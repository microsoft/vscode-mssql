# AI completion debugging (private preview)

This extraction brings the completion viewer from `dev/refactor` at `239fa6acc`
into the Debug Console and AI completion preview. It depends on PRs #22835 and
#22863. The temporary PR base combines those two changes so this PR's diff contains
only the completion debugging tools. Retarget it to `main` after both prerequisites
merge. The prerequisite PRs remain independent.

## Enable and open

Set these workspace or user settings, then reload the Extension Development Host:

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.debugConsole.enabled": true,
    "mssql.copilot.inlineCompletions.enabled": true
}
```

Run **MSSQL: Open Inline Completion Debug**. It opens the Debug Console's
**Completions** page. Set
`mssql.copilot.inlineCompletions.debug.standalonePanel` to `true` to use the separate
viewer instead. All preview flags and standalone mode default to off.

The Live view shows completion requests, outcomes, prompts, model responses,
timings, and acceptance. Profile, model, schema, prompt, and debounce controls
apply session overrides. Editing unrelated controls preserves schema and category
opt-outs. Models come from the current VS Code language-model catalog; the existing
AI completion PR's preferences and explicit model settings remain authoritative.

The Sessions view loads saved traces and supports importing files, selecting
events, assembling replay runs, and comparing profile/schema experiments.
Replays call the selected language model; they do not execute the generated SQL.
Feature disablement cancels active replays and prevents further model requests.

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

Included: both completion viewers, shared command/state services, capture journals,
saved completion sessions, replay queues/matrices, trace analysis, and model/settings
experiments. Existing cancellation, privacy, schema, and model fixes from #22863
are retained.

Deferred: Query Studio, native scripting/query commands, generic cross-feature
Replay Lab pages, central upload, and the general session-bundle integration. The
existing Connections v2 boundary is unchanged. The debug-console performance
scenario now seeds its preview settings before activation.

Validation uses the combined tree: extension/toolkit unit tests, repository tests,
the performance harness suites (including a disposable local SQL integration
database), editor/grid tests, and live classic-query/OE performance scenarios.
Single-repetition diagnostic runs verify operation; they do not establish a
performance regression baseline. Exact results and any outstanding failures are
recorded in the PR description.
