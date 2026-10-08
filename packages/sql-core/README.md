# sql-core

VS Code-independent SQL building blocks and data providers for agents and tools. The package does
not import `vscode`.

| Import                 | Contents                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql-core`             | Shared building blocks: the `SqlReader` contract, T-SQL literal functions, platform detection, SQL error categories, and the session preamble. |
| `sql-core/performance` | Performance providers: Query Store reports and plan forcing, Query Insights top queries, active requests, and blocking chains.                 |

- Callers supply a `SqlReader` that runs T-SQL and returns result sets. The MSSQL extension provides
  readers for the SQL data plane and the headless query executor.
- Readers do not bind parameters. Every value in generated SQL goes through a function in
  `literals` or through the validated parameter helpers of the Query Store port
  (`prependSqlParameters`), which check it first.
- Providers return codes, not display text. Callers localize the text.
- Results are JSON-serializable, so callers can send them to webviews and language model tools.

## Results

Every run function returns a `PerfResult<T>`:

| Field           | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `status`        | See the statuses below.                                                         |
| `platform`      | The `SqlPlatform` of the connection.                                            |
| `source`        | `queryStore`, `queryInsights`, `dmv`, or `pdwDmv`.                              |
| `scope`         | `instance`, `database`, `pool`, `server`, or `item`.                            |
| `observedAtUtc` | The time of the request (`options.now`), ISO 8601 UTC.                          |
| `data`          | The result. Set for `ready`, and for some `noData` and `notConfigured` results. |
| `missing`       | `MissingDataCode` values for data that the result does not include.             |
| `error`         | The message and SQL error number of a failed read.                              |

| Status                   | Meaning                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `ready`                  | The data is complete for the request.                                                           |
| `noData`                 | The source works but has no rows for the request. Reports keep their `columns`.                 |
| `selfOnly`               | The principal sees only its own sessions and requests.                                          |
| `notConfigured`          | The platform supports the source, but it is off (Query Store OFF or in the error state).        |
| `permissionMissing`      | The principal does not have the necessary permission.                                           |
| `unsupported`            | The platform, the version, the replica group, or the requested metric is not available.         |
| `temporarilyUnavailable` | A timeout, lock timeout, throttling, failover, or cancel stopped the read. A retry can succeed. |
| `failed`                 | Any other failure.                                                                              |

| Missing data code               | Meaning                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `queryStoreReadOnly`            | Query Store is READ_ONLY. It does not capture new data, so the data can be old. `probeQueryStore` gives the reason. |
| `queryStoreWaitStats`           | No wait statistics (SQL Server 2016, Synapse).                                                                      |
| `queryStoreLogAndTempdbMetrics` | No log and tempdb metrics (SQL Server 2016).                                                                        |
| `queryStoreResourceMetrics`     | Only duration and execution count (Synapse dedicated pools record 0 for the other metrics).                         |
| `regressedPlanChanges`          | The plan read of the regressed queries failed, so `planChanges` is not set.                                         |
| `statementText`                 | The statement text of some sessions.                                                                                |
| `otherUsersRequests`            | The requests of other users (Fabric Warehouse).                                                                     |
| `cpuReadsAndMemory`             | CPU, reads, and memory of active requests (Synapse dedicated pools).                                                |

A configuration that is not valid, such as an ID that is not a `bigint` or a sort column that no
report has, makes a run function throw a `RangeError` before it reads.

## Session preamble

Every batch starts with `sessionPreamble(info, purpose)`. On SQL Server, Managed Instance, Azure SQL
Database, and SQL database in Fabric:

- `read` (reports, probes, and the state reads of a change): `SET NOCOUNT ON`,
  `READ UNCOMMITTED`, `LOCK_TIMEOUT 5000`, `DEADLOCK_PRIORITY LOW`. A lock wait stops with error
  1222, which maps to `temporarilyUnavailable`.
- `change` (the force and unforce batch): `READ COMMITTED` and `LOCK_TIMEOUT 10000`.

Other platforms get only `SET NOCOUNT ON`. Only live DMV reads (active requests) add
`OPTION (MAXDOP 1)`. Query Store reports do not.

## Query Store reports

Signature: `runX(reader, info, config, options?) => Promise<PerfResult<...>>`. `options` is
`QueryStoreRunOptions`: `signal`, `timeoutMs`, `now`, and the cached `availableMetrics` and
`isQdsRoAvailable` from `probeQueryStore`, which skip the probes.

| Function                                  | Report                                                              | Data                     |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| `probeQueryStore(reader, info, options?)` | State, read-only reason, metrics, and replicas                      | `QueryStoreCapabilities` |
| `runTopResourceConsumersSummary`          | Top resource consumers, one metric                                  | `QueryStoreReport`       |
| `runTopResourceConsumersDetailedSummary`  | Top resource consumers, every available metric                      | `QueryStoreReport`       |
| `runRegressedQueriesSummary`              | Regressed queries, one metric, with plan changes                    | `RegressedQueriesReport` |
| `runRegressedQueriesDetailedSummary`      | Regressed queries, every available metric, with plan changes        | `RegressedQueriesReport` |
| `runHighVariationSummary`                 | High variation, one metric                                          | `QueryStoreReport`       |
| `runHighVariationDetailedSummary`         | High variation, every available metric                              | `QueryStoreReport`       |
| `runOverallResourceConsumption`           | Totals for each time bucket                                         | `QueryStoreReport`       |
| `runForcedPlanQueries`                    | Forced plans                                                        | `QueryStoreReport`       |
| `runTrackedQueries`                       | Queries whose text contains the search text                         | `QueryStoreReport`       |
| `runPlanSummaryChart`                     | The plans of a query for each time bucket                           | `QueryStoreReport`       |
| `runPlanSummaryGrid`                      | The plans of a query                                                | `QueryStoreReport`       |
| `runWaitStatsByCategory`                  | Wait time for each wait category                                    | `QueryStoreReport`       |
| `runWaitStatsQueriesForCategory`          | Wait time for each query in a wait category                         | `QueryStoreReport`       |
| `runQueryWaitCategories`                  | Wait time for each wait category of one query                       | `QueryStoreReport`       |
| `runQueryText`                            | Query text, or the module's `ALTER` script and the query's position | `QueryTextResult`        |
| `runPlanXml`                              | Showplan XML of a plan                                              | `PlanXml`                |

Each run function:

1. Checks the platform. Query Store reports run on SQL Server 2016 and later, Azure SQL Managed
   Instance, Azure SQL Database, and SQL database in Fabric. Synapse dedicated pools allow only
   the `duration` and `executionCount` metrics, and have no plan forcing or wait stats. Synapse
   serverless, Fabric Data Warehouse, the SQL analytics endpoint, and unknown platforms give
   `unsupported` without a read.
2. Runs one probe batch: the Query Store state (`queryStoreOperationalModeQuery`), the metrics
   (`availableMetricsProbeQuery`) when the report needs them, and the replica column probe
   (`replicaGroupColumnProbeQuery`). OFF or ERROR gives `notConfigured`. READ_ONLY runs the report
   and adds `queryStoreReadOnly`. A requested metric or sort column that the server does not
   record gives `unsupported`. A replica group other than the primary (`replicaGroupId` other than
    1. needs Query Store for secondary replicas, or the result is `unsupported`.
3. Runs the generated query after the read preamble. The generators are a byte-exact port of
   SQL Tools Service; the run functions do not change their SQL. The one exception is the start
   of an early overall consumption window (see below).
4. Maps the rows with the generator's column metadata.

The run configurations are the port's configurations without `isQdsRoAvailable` (the probe sets
it), plus `orderByColumnId` and `descending`. The default order is the selected metric's column,
descending (the regression for regressed queries, `bucket_start` ascending for overall
consumption).

The overall consumption query casts the window start to `datetime`, which starts at 1753-01-01.
SSMS sends 0001-01-01 for All time, so its report fails. When the window starts before
1753-01-01, for example `allTime`, `runOverallResourceConsumption` starts it at the oldest Query
Store interval instead. The probe batch reads that interval (`MIN(start_time)` from
`sys.query_store_runtime_stats_interval`). When Query Store has no interval in the window, the
result is `noData`, and the report query does not run.

### Report data

```ts
interface QueryStoreReport {
    columns: ReportColumn[];
    rows: ReportRow[]; // Record<column id, string | number | boolean | null>
}

interface ReportColumn {
    id: string; // the SQL column label; unique in the report
    kind: ReportColumnKind; // queryId, statisticMetric, bucketStartTime, ...
    valueType: "id" | "number" | "text" | "date" | "boolean";
    metric?: QueryStoreMetric;
    statistic?: QueryStoreStatistic;
    timeInterval?: "recent" | "history";
    unit?: "millisecond" | "kilobyte" | "percent";
}
```

Values are normalized by `valueType`: IDs are decimal strings (so `bigint` IDs stay exact),
numbers are numbers, dates are ISO 8601 UTC strings, and `bit` values are booleans. SQL `NULL` is
`null`. When two columns have the same label, the second gets an ID from its kind, for example
`last_forced_plan_exec_time` in the Forced Plans report. `findReportColumn(columns, criteria)`
finds a column by kind, metric, statistic, and window.

### Regressed queries: new plans

`RegressedQueriesReport.planChanges` has one `RegressedPlanChange` for each row. After the report,
one more batch lists the plans that ran in each window for the returned query IDs (bigint
literals, no `STRING_SPLIT`), with the report's window filter
`NOT (rs.first_execution_time > @end OR rs.last_execution_time < @start)`:

- `newPlan`: the recent window has a `query_plan_hash` that the history window does not have. A
  recompile to the same shape with a new `plan_id` is not a new plan.
- `baselinePlanRetained`: false when Query Store has no plan that ran in the history window. Then
  `newPlan` is false, because there is nothing to compare.
- `history` and `recent`: `planCount`, `planIds`, and `planHashes` of each window, and
  `newPlanHashes`.

If the plan batch fails (other than a cancel), the report is kept and `missing` has
`regressedPlanChanges`.

## Plan forcing

Plan forcing runs on SQL Server 2016 and later, Azure SQL Managed Instance, Azure SQL Database,
and SQL database in Fabric. Other platforms give `unsupported`.

**The library does not ask for approval.** The caller must get the user's approval between
prepare and apply:

1. **Prepare.** `prepareForcePlan(reader, info, { queryId, planId, replicaGroupId? })` or
   `prepareUnforcePlan(...)` reads the state and returns a `PreparedChange`:

    ```ts
    interface PreparedChange {
        kind: "forcePlan" | "unforcePlan";
        target: { queryId: string; planId: string; replicaGroupId: string };
        sql: string; // the change preamble and the EXEC sp_query_store_(un)force_plan batch
        prior: PlanForcingState; // Query Store state, the target plan, the forced plans
        blockers: PlanChangeBlocker[]; // reasons the change must not run
        warnings: PlanChangeWarning[]; // what the user should know
    }
    ```

    Blockers: `queryStoreNotReadWrite`, `planNotFound`, `planNotForQuery`, `planAlreadyForced`,
    `planNotForced`, `autoForcedPlan` (automatic tuning forced a plan for the query),
    `dispatcherPlan` (force the variant plan instead). Warnings: `replacesForcedPlan`,
    `planForcingTypeUnknown` (SQL Server 2016 or a secondary replica group), `variantPlan`,
    `dispatcherPlan` (unforce), `previousForceFailures`.

2. **Approve.** Show `sql`, `prior`, `warnings`, and `blockers` to the user. Do not ask for
   approval when there are blockers.
3. **Apply.** `applyPreparedChange(reader, info, prepared)` reads the state again. It refuses the
   change (`applied: false` with blockers) when the change has blockers now, when the state is not
   the same as `prior` (`stateChanged`), or when `sql` is not the SQL for the target
   (`preparedSqlMismatch`). Otherwise it runs `sql` and returns `appliedAtUtc`, the server time
   just before the change.
4. **Verify.** `verifyForcedPlan(reader, info, { queryId, planId, since: appliedAtUtc })` reads
   `is_forced_plan`, `force_failure_count`, `last_force_failure_reason_desc`, and
   `last_execution_time` of the plan, and the executions of the query for each plan. It counts
   only the runtime stats intervals that start at `countedFrom`: the end of the interval that
   contains `since`. That interval is not counted, because it can include executions from before
   the change. Each plan is `forcedPlan`, `samePlanShape` (same `query_plan_hash`), or
   `otherPlan`. `outcome` is `forcedPlanInUse`, `otherPlansInUse`, `noExecutions`,
   `waitingForNextInterval` (the server time is before `countedFrom`), `notForced`, or
   `planNotFound`. The failure count changes only at a compile, so verify again after the query
   runs.

`prepared` is JSON-serializable, so it can go to a webview and back.

## Query Insights

`runQueryInsightsTopQueries(reader, info, { metric, start, end, top }, options?)` reads the top
queries of Fabric Data Warehouse and the SQL analytics endpoint from
`queryinsights.exec_requests_history`. The metrics are `cpu`, `duration`, `executions`, and
`dataScanned`. Other platforms give `unsupported`.

## Live activity

`getActiveRequests(reader, info, options?, now?)` reads the running requests and builds the
blocking chains on SQL Server, Azure SQL, Fabric, and Synapse.

## Commands

```bash
npm run build -- --target sql-core
npm test -- --target sql-core
npm run lint -- --target sql-core
```
