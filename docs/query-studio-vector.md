# Query Studio vector workbench (private preview)

This preview adds six workspaces to Query Studio results containing a native SQL `vector` column. It is extracted from `dev/refactor` as a complete feature so the workflow can be evaluated as a unit. It does not require the separate spatial or Chat to Data changes.

Enable these settings, reload the extension, and run **MS SQL: Query Studio: New Query** (or open a `.mssql` document):

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.queryStudio.vectorWorkbench.enabled": true
}
```

Keep the SQL Tools Service provider selected. Native vector transport is required; JSON-looking strings do not enable this pane. Run a query against a server that supports native vectors, then select **Vector** in the results tabs. The default settings leave existing editors and result views unchanged.

| Workspace  | What to try                                                                                                                                                       | Where the work runs                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Profile    | Inspect dimensions, norms, duplicates, component variance, and findings.                                                                                          | Local worker over the retained result rows; sampling and limits are shown.                                      |
| Search     | Use a selected result row, a pasted vector, an expression, or a confirmed model-generated vector. Compare exact neighbors with approximate search when supported. | Bounded SQL on a separate session using the live connection's provider and current database.                    |
| Compare    | Enter result row ordinals such as `0, 1, 4`; inspect pairwise distances and component differences.                                                                | Local worker. Ordinals refer to the original result, not the current grid sort order.                           |
| Projection | Explore the deterministic PCA scatter plot; select points, pan, zoom, and reset the view.                                                                         | Local worker and canvas. This is a visualization, not evidence of semantic relevance.                           |
| Index      | Inspect verified targets, capabilities, catalog facts, findings, and generated scripts.                                                                           | Catalog/probe queries. Generated DDL is shown for review and is never executed by this pane.                    |
| Pipeline   | Select a text column, preview chunks, and optionally compare a stored vector with a newly generated embedding.                                                    | Chunk preview is local. Model execution runs through a configured SQL external model and requires confirmation. |

Server support and permissions vary. Unavailable approximate search, index metadata, or external models are reported in the relevant workspace. Model requests disclose the configured destination and source text before execution; merely opening a page does not invoke a model. No external model or index is created automatically. Search comparison may run several statements and does not promise a transactionally stable snapshot.

Pinned, completed original results support Profile, Compare, and Projection. Search, Index, and Pipeline require a live connection and are disabled in pins. Hiding or disabling the feature releases its analysis services; disconnects close auxiliary database sessions, including sessions whose connection attempt completes late. At most two auxiliary sessions may be open or opening per document.

## Reproducible sample

Use a scratch database on SQL Server 2025+ or another server with native vector support. Run [query-studio-vector-demo.sql](samples/query-studio-vector-demo.sql) once, then execute:

```sql
SELECT id, title, category, body, embedding
FROM dbo.VectorSamples
ORDER BY id;
```

The 128 rows and 64-dimensional vectors are synthetic and deterministic. They illustrate the UI and numerical operations; they are not a real embedding model or a search quality benchmark. The sample creates one table and does not create an index or external model.

The PR screenshots use this shape of data. Pipeline shows chunk preview with no external model configured. Index shows the server's actual capabilities and generated scripts, not a fabricated successful index build.

## Validation

Unit suites cover worker math, bounds, cancellation, vector SQL construction, target identity, catalog/probe behavior, search, index, and pipeline lifecycles. Live tests use the existing optional SQL test environment variables. The opt-in Playwright suite reads a prepared synthetic fixture:

```powershell
$env:VECTOR_WORKBENCH_TEST_DATABASE = "your_vector_test_database"
# Set the usual e2e SQL connection variables without checking credentials in.
npx playwright test test/e2e/queryStudioVector.spec.ts --workers=1 --retries=0
```

Set `VECTOR_WORKBENCH_SCREENSHOTS` to an output directory to capture all six workspaces. SQL Server versions without native vectors cannot run this fixture. The test covers actual controls and results, local pinned analysis, and the boundary between local analysis and SQL/model work.
