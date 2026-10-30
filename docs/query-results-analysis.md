# Chat to Data (Private Preview)

Chat to Data analyzes completed Query Studio results locally. It does not execute SQL or update the database. This extraction includes the transform engine, the `mssql_query_results` Copilot tool, derived pinned results, and the `@query` chat participant as one feature.

## Enable and try

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.queryResults.ai.enabled": true
}
```

Reload the extension after enabling Query Studio. Open a `.mssql` file or run **MS SQL: Query Studio: New Query**, connect, execute a query, and click its result grid. SQL files keep using the existing editor.

In VS Code Chat (with a supported language model available):

- `@query /list` lists available live results and snapshots.
- `@query /summarize` computes row counts and null ratios locally.
- `@query /profile` adds column minima/maxima after confirmation.
- `@query /report` asks the selected chat model to write a report from local statistics and an optional, separately confirmed sample of up to ten rows.
- `@query /pin` opens the focused live results as a read-only pinned document.

In Agent mode, include `#mssql_query_results`, for example: “Using #mssql_query_results, group these results by region and calculate total sales,” or “Filter these results to sales over 100 and pin that filtered view.” The tool can freeze a snapshot, inspect its schema, evaluate a bounded transform, and open a derived snapshot. It must identify the source from the available results; it cannot query an unrelated database.

## Data handling and limits

AI result access defaults **off**. Enabling it permits schema, names, counts, and numeric aggregates to enter chat/model context without a value-sharing confirmation. Raw samples, group keys, minima/maxima, and other value-bearing output require confirmation. A report can still use metadata and numeric statistics when sample sharing is declined.

The engine supports filter, project, slice, rows, aggregates, grouping, top-K, histograms, distinct counts, and sampling. It scans bounded local windows and reports partial coverage when a time, row, group, or output budget is reached. Numeric calculations use JavaScript numbers; this is exploratory analysis, not a replacement for exact SQL decimal arithmetic or SQL collation semantics. Truncated cells are not silently compared as complete values.

Derived pins preserve source rows; they support filters and slices, not aggregate tables or column projection. The original immutable store stays leased while a derived pin is open. Closing the source or rerunning its query does not replace the pinned data. Transient participant snapshots are released when a request finishes. Tool snapshots expire under the existing retention policy and can also be released explicitly.

Policy overrides use the existing `mssql.queryResults.overrides` dictionary. For example:

```json
"mssql.queryResults.overrides": {
    "aiMaxRowsPerResponse": 50,
    "aiMaxBytesPerResponse": 65536,
    "aiMaxCellBytes": 1024,
    "transformMaxRowsScanned": 100000,
    "transformMaxEvalMs": 5000
}
```

Bounds are clamped, response sizes count UTF-8 bytes, and values are delimited as untrusted data. Local diagnostics record structural statistics rather than row values or filter literals. Model quality and which tools a model chooses still depend on the selected Copilot model.

Spatial, vector, query replay, and schema designer features are outside this PR.
