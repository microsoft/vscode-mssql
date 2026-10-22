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

Basic pins are enabled within Query Studio by default. They can be disabled with
`mssql.queryResults.pinnedDocuments.enabled`. Retention and tuning settings are
advanced controls; normal testing does not require changing them.

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

## Validation entry points

- Hosted unit tests: Query Studio document synchronization, execution, SQLCMD,
  storage, export, language services, activation, Save As boundaries, pinned
  results, native OE delivery, and shared FluentResultGrid.
- `test/e2e/queryStudio.spec.ts`: preview on/off, `.sql`/`.mssql` editor selection,
  editing, saving, undo, and untitled creation in an isolated VS Code profile.
- `test/e2e/queryStudioExecution.spec.ts`: live SQL execution, embedded actual
  plans, and pinned results that remain available after the source query reruns.
- Performance scenarios: `querystudio-open`, `querystudio-query-10k`, wide/blob
  results, scalar focus, cancellation, SQLCMD, result-grid interactions, and
  `queryresults-pin-after-100k`. SQL fixtures are opened as explicit untitled
  Query Studio copies, preserving their `.sql` association.

Performance runs must use a configured test server. Central-store integration
tests should use a disposable database and login. Do not use a production
database or reinterpret historical refactor results as validation of this branch.
