# Query Studio core (private preview)

Query Studio provides an integrated SQL editor, connection controls, execution,
results, messages, and execution plans. Saved Query Studio documents use `.mssql`.
They are ordinary SQL text files and use the same SQL language registration and
TextMate grammar as `.sql`. Existing `.sql` files keep the normal text editor.

## Enable and open

Set these in **User settings**, then reload VS Code:

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true
}
```

Open a `.mssql` file, or run **MS SQL: Query Studio: New Query** for an untitled
document. **Query Studio: Duplicate as New Query** copies the active SQL document
into a new untitled Query Studio document. Save it with a `.mssql` extension to
continue using Query Studio; VS Code's native SQL Save As dialog may initially
suggest `.sql`. Saving as `.sql` returns to the normal text editor. Query Studio
does not change `workbench.editorAssociations` or the default SQL file extension.

When the preview is disabled, `.mssql` opens in the normal SQL text editor.
All three preview settings default to false. Reload after changing them.

## Included workflows

- Connect using saved connection profiles, select a database, reconnect, and
  disconnect. Query Studio owns its SQL Data Plane session.
- Edit with SQL syntax highlighting and language features, undo/redo, save,
  selection execution, cancellation, SQLCMD, and production-connection warnings.
- View streaming result grids and messages, copy selections, export results,
  open large cell values, and inspect estimated or actual execution plans.
  Plan viewing and comparison reuse the current extension renderer.
- Pin one result set or all results into a read-only tab. Pins retain their
  result data across query reruns and source-editor closure, with shared storage
  leases and bounded spill storage. Pins are session-local: they do not survive
  a window reload. Closing a pinned tab releases its lease.
- Use the existing inline SQL completion provider when its separate preview is
  enabled. Its model and schema-sharing settings remain authoritative.

SQL IntelliSense popups stay quiet inside comments and string literals with
either language engine. AI inline suggestions can still answer comment prompts.
The balanced schema context prioritizes complete foreign-key paths between
mentioned tables, searching up to two hops from each endpoint within the existing
table and prompt budgets. Missing metadata can still produce an empty AI answer
instead of invented columns; the Completions debug view shows the supplied schema.

Basic pins are enabled within Query Studio by default. They can be disabled with
`mssql.queryResults.pinnedDocuments.enabled`. Retention and tuning settings are
advanced controls; normal testing does not require changing them.

Live and pinned grids use the existing results preferences, including
`mssql.resultsGrid.rightAlignNumbers`,
`mssql.resultsGrid.freezeFirstColumnByDefault`, and `mssql.copyIncludeHeaders`.
Appearance and copy preferences update in open grids; the freeze preference sets
the initial state and does not override a saved freeze/unfreeze choice.
`mssql.results.showBatchMessages` controls synthesized execution messages on the
next run while retaining server PRINT output and errors. Save As waits for the
selected result set to finish streaming; completed sets can be exported while
later batches are still running. Export retains that run's data through the Save
dialog, even if the query is rerun before saving.
The existing `mssql.query.displayUniqueIdentifierInUppercase` preference also
applies to grid, copy, and export values on the next run. It defaults to true;
false produces lowercase GUIDs. Text columns retain their original case, and
pinned results retain the formatting captured by their source run.

To launch queries from **Connections (Private Preview)**, also enable
`mssql.objectExplorer.v2.enabled` before reloading. New Query, Select Top 1000,
and supported Script As Create/Alter/Drop/Execute commands deliver SQL to Query
Studio. Select Top respects `mssql.query.preventAutoExecuteScript`; Script As opens SQL for review without
executing it. Other Connections commands keep the existing classic connection
bridge. Scripting choices follow the capabilities of each object type.

## Extraction boundary

This is the next independent extraction after the combined completion/debug/OE
work and its review follow-up (#23129 and #23130). The source refactor was
reconciled with those merged changes on `dev/karlb/refactor_sync` before this
branch was created from `main`. Main's accepted grid, execution-plan renderer,
completion controls, and debug console remain the integration baseline.

Basic pinned results are included because comparing reruns is part of the core
query workflow. Result transforms, chat-to-results, vector/spatial workbenches,
and query replay UI remain later extractions. Docker lifecycle and schema
visualizer work also remain separate. Those implementations are retained in the
sync branch.

## Recent main grid audit

The August 1–October 21, 2026 grid changes on `main` were reviewed during this
extraction. Query Studio uses the current shared FluentResultGrid, so fixes in
that component apply to both its live and pinned grids. The host and adapter
settings below needed explicit integration with Query Studio's own execution
and storage pipeline.

| Main change                                                                                                                                                                                                                                          | Query Studio integration                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming/rendering improvements ([#22653](https://github.com/microsoft/vscode-mssql/pull/22653), [#22893](https://github.com/microsoft/vscode-mssql/pull/22893))                                                                                    | Uses the shared renderer with bounded row/column windows and lazy result mounting.                                                                                                              |
| Scroll restoration ([#22742](https://github.com/microsoft/vscode-mssql/pull/22742), [#22897](https://github.com/microsoft/vscode-mssql/pull/22897))                                                                                                  | Uses the current grid and persisted per-result scroll state.                                                                                                                                    |
| Selection, mouse-button guards, and keyboard parity ([#22792](https://github.com/microsoft/vscode-mssql/pull/22792), [#22807](https://github.com/microsoft/vscode-mssql/pull/22807), [#22842](https://github.com/microsoft/vscode-mssql/pull/22842)) | Inherited from the shared grid.                                                                                                                                                                 |
| Ctrl+Insert ([#22795](https://github.com/microsoft/vscode-mssql/pull/22795))                                                                                                                                                                         | Uses the shared shortcut and now honors `copyIncludeHeaders` for plain copy.                                                                                                                    |
| Freeze first column ([#22794](https://github.com/microsoft/vscode-mssql/pull/22794))                                                                                                                                                                 | Reads the existing preference through the shared initial-state helper; saved grid state takes precedence.                                                                                       |
| Hide batch messages ([#22762](https://github.com/microsoft/vscode-mssql/pull/22762))                                                                                                                                                                 | Gates synthesized batch start, affected-row, and timing messages without suppressing server output or errors.                                                                                   |
| Resizable row numbers and updated SlickGrid ([#22831](https://github.com/microsoft/vscode-mssql/pull/22831), [#22903](https://github.com/microsoft/vscode-mssql/pull/22903))                                                                         | Inherited from the shared grid and current dependency.                                                                                                                                          |
| Visible leading/repeated spaces ([#22915](https://github.com/microsoft/vscode-mssql/pull/22915))                                                                                                                                                     | Uses the shared cell renderer and whitespace styles.                                                                                                                                            |
| Non-US keyboard shortcuts and numeric alignment ([#23051](https://github.com/microsoft/vscode-mssql/pull/23051))                                                                                                                                     | Uses shared keyboard handling; passes `rightAlignNumbers` to live and pinned grids, including live preference updates.                                                                          |
| GUID casing ([#23037](https://github.com/microsoft/vscode-mssql/pull/23037))                                                                                                                                                                         | Applies the existing uppercase/lowercase preference to typed `uniqueidentifier` values as pages enter the result store, keeping grid/copy/export/pins consistent without changing text columns. |
| Prevent saving streaming partial results ([#23038](https://github.com/microsoft/vscode-mssql/pull/23038))                                                                                                                                            | Checks the selected set before Save As and holds an export lease on the selected run's store.                                                                                                   |

The classic results preview-grid switch is not added to Query Studio, which
already uses the shared Fluent grid. Its editor and result-storage architecture
remain independent of the classic query editor.

## Validation entry points

- Hosted unit tests: Query Studio document synchronization, execution, SQLCMD,
  storage, export, language services, activation, Save As boundaries, pinned
  results, native OE delivery, and shared FluentResultGrid.
- `test/e2e/queryStudio.spec.ts`: preview on/off, `.sql`/`.mssql` editor selection,
  editing, saving, undo, and untitled creation in an isolated VS Code profile.
- `test/e2e/queryStudioExecution.spec.ts`: live SQL execution, embedded actual
  plans, and pinned results that remain available after the source query reruns.
- `test/e2e/queryStudioGrid.spec.ts`: live/pinned grid preferences, clipboard,
  keyboard layouts, whitespace, frozen-column state, and batch messages.
- Performance scenarios: `querystudio-open`, `querystudio-query-10k`, wide/blob
  results, scalar focus, cancellation, SQLCMD, result-grid interactions, and
  `queryresults-pin-after-100k`. SQL fixtures are opened as explicit untitled
  Query Studio copies, preserving their `.sql` association.

Performance runs must use a configured test server. Central-store integration
tests should use a disposable database and login. Do not use a production
database or reinterpret historical refactor results as validation of this branch.
