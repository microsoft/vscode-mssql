# sql-core

VS Code-independent SQL building blocks and data providers. The package does not import `vscode`.

| Import                | Contents                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sql-core/common`     | The `SqlReader` contract, the `ReadResult` type, T-SQL literals, platform detection, SQL error categories, and the preamble. |
| `sql-core/queryStore` | Typed Query Store objects and the reads and changes that return them.                                                        |

`sql-core` (the package root) is the same as `sql-core/common`.

## Readers

Callers supply a `SqlReader` that runs a T-SQL batch and returns its result sets. Readers do not
bind parameters: every value in generated SQL goes through a function in `literals`, which checks
it first. Results are JSON-serializable, so callers can send them to webviews as they are.
Providers return codes, not display text; callers localize the text.

## Query Store

Read the capabilities of a connection once with `readQueryStoreCapabilities(reader)`, and pass
them to every read. They say whether the platform has Query Store (SQL Server 2016 and later,
Azure SQL Managed Instance, Azure SQL Database, and SQL database in Fabric) and which columns the
server has.

Each read is one batch: the read preamble, the Query Store state, and the query. Query Store OFF
or in the error state gives `notConfigured`; every result has `queryStore.actualState`, so callers
can show that a `readOnly` Query Store does not capture new data. A request that is not valid,
such as an ID that is not a `bigint`, rejects with a `RangeError` before it reads.

| Function                                                                                     | Returns                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `getQueryStoreOverview`                                                                      | `QueryStoreOverview`: the state and the start of the oldest interval                                                                         |
| `getTopQueries`                                                                              | `TopQueries`: the top `QueryStoreQuery` objects and the totals of all queries                                                                |
| `getQueryDetails`                                                                            | `QueryStoreQueryDetails`: one query with its full text and forced plan                                                                       |
| `getQueryHistory`                                                                            | `QueryStoreInterval[]`: a query's runtime stats for each interval or bucket of intervals, per plan (`historyBucketMinutes` picks the bucket) |
| `getWaitStats`                                                                               | `QueryStoreWaitStats`: wait time by category for the database, a query, or a plan, with the executions' duration                             |
| `buildQueryAnalysis`                                                                         | `QueryAnalysis`: a query, its plans, history, waits, and plan summaries in one object                                                        |
| `getQueryPlans`                                                                              | `QueryStorePlan[]`: every plan of a query with its runtime stats                                                                             |
| `getPlanXml`                                                                                 | The showplan XML of a plan                                                                                                                   |
| `summarizePlan`                                                                              | `PlanSummary`: statement facts, warnings, missing indexes, parameters, and the costliest operators of a showplan                             |
| `preparePlanChange`                                                                          | `PreparedPlanChange`: a force or unforce for the user to approve                                                                             |
| `applyPlanChange`                                                                            | `AppliedPlanChange`, after reading the state again                                                                                           |
| `verifyForcedPlan`                                                                           | `ForcedPlanVerification`: which plans ran since the change                                                                                   |
| `readQueryStoreSettings`, `prepareQueryStoreSettingsChange`, `applyQueryStoreSettingsChange` | The settings and their change path                                                                                                           |

### Runtime stats

Queries, plans, and intervals extend `QueryStoreRuntimeStats`: the execution count, and a
`MetricStats` (`total`, `avg`, `min`, `max`, `stdev`) for each requested `QueryStoreMetric`. Times
are in milliseconds and sizes in KB. A runtime stats interval counts in a window when it starts in
the window. On a server with Query Store for secondary replicas, reads count the primary replica.

`getTopQueries` sums the window's runtime stats for each plan into a table variable once, and
takes both the totals and the top queries from it. It reads the text of the top queries only, and
only their first 4,000 characters; `getQueryDetails` has the full text. Each query has
`readsOnlySystemCatalog`, true when it reads only catalog views, as tools such as Object Explorer
do.

### Changes

The library does not ask for approval. Prepare a change, show its SQL, blockers, and warnings to
the user, and apply it only after approval, on a session for changes. Apply reads the state again
and refuses a change whose state or SQL changed.

## Commands

```bash
npm run build -- --target sql-core
npm test -- --target sql-core
npm run lint -- --target sql-core
```
