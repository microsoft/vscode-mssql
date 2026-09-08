# Query Store Experience, Setup, and Diagnosis Plan

Status: Draft for product review. Planning only; no implementation or database changes are authorized.

Date: 2026-09-07

Companions: [DMV experience plan](DMV_EXPERIENCE_PLAN.md) and [sql-feature architecture](TABLE_EDITOR_SPEC.md#17-sql-feature-package-architecture).

## 1. Direction and scope

Create a dedicated Query Store experience that helps users start collecting useful history, understand query performance, investigate changes, and review possible interventions. Use the supplied mocks as the visual foundation: workload overview, query inspector with Summary/Plans/Recommendations, and a settings drawer.

The missing first-class workflow is setup and recovery. Users should never have to infer whether an empty grid means the wrong database, missing permissions, disabled collection, restrictive capture, or simply no history in the selected window.

### Confirmed requirements

- Produce a plan and ask product questions; do not implement it.
- Provide first-time setup as well as ongoing settings management.
- Make historical evidence digestible and useful for diagnosis.
- Preserve access to SQL, query text, plans, and precise metric definitions.
- Follow the `sql-feature` package direction, with Query Store at `sql-feature/diagnostics/querystore`.

### Product decisions confirmed by the user

| Decision                     | First-release requirement                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Setup and settings execution | Authorized users can review and apply changes directly; SQL generation and administrator handoff are also required. |
| Plan interventions           | Include both reviewed plan forcing/unforcing and Query Store hints, with capability and permission checks.          |
| Primary setup audience       | Developers, with a clear administrator handoff when they lack privileges or need operational review.                |

These answers define the planned product scope. They do not authorize implementation or changes to a connected database in this session.

### Required separate entry point

Confirmed requirement: Query Store has its own command registration (`mssql.queryStore.open`), independently accessible panel, and public package entry point (`sql-feature/diagnostics/querystore`). It must not require opening the combined SQL Diagnostics panel or another feature first.

- The command is discoverable directly in the Command Palette; contextual actions resolve the appropriate connection/scope.
- Opening without prerequisites leads to this feature’s own connection/setup/readiness experience.
- Opening one feature does not initialize unrelated feature collectors or configuration flows.
- Cross-feature investigation links are optional shortcuts, not the sole entry path.

- Command Palette: **MS SQL: Open Query Store** (`mssql.queryStore.open`).
- Database Object Explorer action: **Query performance**.
- Header: **Query performance**, with Query Store clearly identified as the evidence source.
- DMV historical-investigation handoff opens this experience with the same database and any safely transferable filters.
- Separate Query Store from the combined SQL Diagnostics tabs. Keep Agent and other features reachable during migration.
- Panel identity includes connection identity and database identity; friendly labels and query hashes are not identities.

## 2. What to preserve and change in the mocks

| Mock element                                                               | Keep                                 | Refine                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Database breadcrumb                                                        | Persistent target context            | Make wrong/system database selection actionable. Query Store cannot be enabled on master or tempdb.                            |
| Collection/storage summary                                                 | Collection state near the title      | Show actual state and requested state separately when they differ; low storage usage alone cannot prove collection is working. |
| Time range, metric, compare control                                        | One consistent investigation context | Add aggregation choice and visible baseline dates; do not mix previous-period and previous-plan comparisons.                   |
| Trend chart                                                                | Collapsible workload history         | Label units, aggregation, missing/partial intervals, and coverage; provide an accessible table alternative.                    |
| Regressed / Top consumers / High variation / Forced & hinted / All queries | Task-focused views                   | Counts use the same scope/filter definitions as the evidence; unavailable hint capabilities have an explanation.               |
| Compact query preview with impact bars                                     | Scannable workload ranking           | Define the impact denominator and keep total versus per-execution cost explicit.                                               |
| Query inspector                                                            | Summary, Plans, Recommendations      | Add evidence/limitations to each finding, consistent windows, and retained selection when possible.                            |
| Plan timeline                                                              | Plan-specific series                 | “First observed in retained data” is not proof of a single plan switch or its cause; plans may overlap.                        |
| Force previous plan action                                                 | Reviewed intervention concept        | Use “Review plan forcing…” with an explicitly selected plan, not a guessed previous plan.                                      |
| Settings groups                                                            | Collection, retention, storage       | Separate runtime aggregation interval from data flush interval; gate controls by platform/version/permissions.                 |
| Purge and flush                                                            | Advanced maintenance access          | Separate immediate maintenance operations from staged settings Save; purge is not a routine remedy.                            |

The screenshot's master context should lead to **Choose a user database**, not an Enable action or generic empty grid. Microsoft documents the master/tempdb limitation in its [Query Store overview](https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store).

## 3. Readiness and collection state model

Represent readiness, collection state, and evidence coverage separately. A boolean `is_on` is inadequate.

| State                         | Explanation                                                        | Primary action                                  |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| No target                     | No usable database selected                                        | Choose database / Connect                       |
| Unsupported target            | Database/engine/version does not support the requested capability  | Choose supported database or view explanation   |
| Read permission missing       | Cannot inspect required metadata/history                           | Review permission / Copy administrator request  |
| Configure permission missing  | History may be readable; setup cannot be applied by this principal | Continue diagnosis / Generate setup SQL         |
| Off                           | Collection is disabled where that mode is supported                | Set up Query Store                              |
| Collecting                    | Actual state allows collection                                     | Investigate; show capture policy and coverage   |
| Read-only by choice           | History available but collection is intentionally paused           | View history / Review collection settings       |
| Read-only unexpectedly        | Requested write mode differs from actual state                     | Diagnose reported reasons / Review recovery     |
| New-query capture restricted  | Policy may exclude new/infrequent statements                       | Explain policy / Review capture settings        |
| Wait capture unavailable/off  | Duration history may exist without wait history                    | Continue without waits / Review supported setup |
| Collecting, awaiting evidence | Ready but no eligible history yet                                  | Explain next steps / Refresh                    |
| No matches in window          | Data exists outside the current filters/window                     | Reset filters / Choose available period         |
| Error or transitional state   | Server reports an error or has not reached the requested state     | Inspect details / Recheck                       |
| Unknown                       | Check failed or access is inconclusive                             | Retry / Inspect error, without guessing a state |

Read desired/actual state, reason flags, capture configuration, storage, interval settings, retention, and supported capabilities. Decode multiple read-only reasons without discarding unknown bits. Reconcile requested versus actual state after every change. These are explicit properties in [sys.database_query_store_options](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-database-query-store-options-transact-sql).

Do not require collection to be active for all historical reads. Determine whether retained history can actually be read in the current state. An empty or denied metadata result does not prove Query Store is off.

## 4. First-time setup flow

### Entry surface

```text
Query performance                         server / AdventureWorks

Query Store is not collecting history for this database.
Capture query plans and aggregated execution statistics to investigate changes.

[Set up Query Store] [Review setup SQL] [Choose another database]

Already configured elsewhere? [Recheck]
```

This surface appears only when the state is established. A user lacking read access sees an access-resolution surface instead.

### Step 1: Verify the target and access

- Display server, database, edition/version, and relevant replica/writability context.
- Check feature availability and read/configure permissions separately.
- For unsupported system databases, offer a database picker immediately.
- Identify platform-managed constraints; do not offer an operation the service does not support.
- No permissions are granted automatically and no broad administrator role is proposed as the default fix.

### Step 2: Configure collection

Offer **Guided** and **Advanced** views of the same configuration model.

Guided fields:

- Capture policy, with AUTO proposed where supported and suitable, and a plain explanation that not every query is necessarily captured.
- Runtime aggregation interval, labeled as history granularity.
- Wait statistics capture where supported.
- Storage budget with units and current usage if present.
- History retention and size-based cleanup.

Show a platform-aware starting configuration with a rationale. Do not present the mock's 1024 MB, 30 days, or 60 minutes as universally optimal defaults. Preserve existing settings when resuming an already configured database; applying a guided preset is an explicit choice with a diff.

Advanced configuration additionally exposes supported capture-policy thresholds and data flush interval. Explain relevant tradeoffs such as history granularity, retained storage, and capture coverage. Validate supported ranges server-side and in the UI.

### Step 3: Review

Show:

- Exact target and current → proposed values.
- Complete generated SQL, with safe identifier handling and validated options.
- What will start/stop being collected and whether old history is affected.
- Required privileges and administrator handoff when the user cannot apply.
- Expected verification steps and any platform-specific limitations.

Actions: **Apply setup**, **Open SQL**, **Copy administrator request**, **Back**, **Cancel**. Apply is required for supported operations when the user has the necessary permissions. Script generation does not imply execution or setup completion.

### Step 4: Apply and verify

- Re-read relevant configuration before execution; detect changes since review and show a new diff rather than overwriting them.
- Submit only the reviewed target/options and prevent duplicate submissions.
- Preserve errors and distinguish execution failure from verification failure or unknown outcome.
- Re-read actual state and settings. Report success only when the desired condition is verified.
- If the request succeeded but collection remains read-only, show the reported reasons and recovery options.
- For externally executed SQL, Recheck runs the same verification path.

### Step 5: First evidence

```text
Query Store is configured and collecting.
No matching execution history is available yet.

Run your application's normal workload, then refresh this view.
The selected capture policy may omit infrequent, low-cost statements.

[Refresh] [Review capture policy] [Open a query editor]
```

Explain that enabling collection does not reconstruct past execution history. Opening a query editor never auto-executes a test workload. Do not promise that waiting for a full aggregation/flush interval is always required before data can be visible. Report the selected period, known history coverage, and provisional current interval.

## 5. Settings and recovery drawer

Keep the mock's grouping and add **Actual collection state** as a read-only status above editable settings.

| Group            | Controls                                                                           | Behavior                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Collection       | Requested operation mode, capture mode, runtime aggregation interval, wait capture | Unsupported choices hidden or explained; requested mode does not overwrite actual-state display. |
| Advanced capture | Custom eligibility thresholds where supported                                      | Explain units and policy logic; do not treat NONE as a synonym for READ_ONLY.                    |
| Persistence      | Data flush interval                                                                | Distinct from chart bucket size and runtime aggregation interval.                                |
| Retention        | Stale-history policy, size-based cleanup                                           | Explain that retained history can be removed; no uninterrupted-collection guarantee.             |
| Storage          | Current usage, configured maximum                                                  | Low usage is one observation, not a collection health verdict.                                   |
| Maintenance      | Flush, clear history, other supported recovery actions                             | Separate review/execution flow; not bundled into Save.                                           |

The mock's “cleanup … so collection is never interrupted” must become a qualified explanation. Service constraints also matter: Azure SQL Database single/elastic-pool databases do not support turning Query Store off in the same way as SQL Server. Capture NONE limits new-query capture; it is not a general stop-all-collection switch. Confirm all controls against the target using [Query Store management guidance](https://learn.microsoft.com/en-us/sql/relational-databases/performance/manage-the-query-store).

### Recovery paths

- **Storage limit/read-only:** show actual reason, size, and policy; offer reviewed storage/retention/capture adjustments where appropriate. Do not repeatedly request READ_WRITE without resolving the cause.
- **Permissions:** offer the minimal target-specific request, exact script for an administrator if appropriate, and Recheck.
- **Wait history missing:** identify whether unsupported, disabled, outside retained coverage, or empty; enabling wait capture does not backfill history.
- **Configuration drift:** preserve unsaved settings and review new server values before applying.
- **Internal error:** expose server detail and documented recovery steps; no automatic destructive clear as a catch-all.

### Distinct maintenance semantics

- **Disable collection** and **Clear Query Store history** must have different labels, scripts, and consequences; the existing controller conflates OFF with discarding all collected data.
- **Flush** persists supported in-memory Query Store data; it is not cache clearing, workload generation, or a guaranteed fix for empty history.
- **Clear history** requires a dedicated review explaining exactly which data/configuration artifacts the target operation removes, informed by platform documentation. Export where available is not a promise of full Query Store backup/restore.
- Cancelling settings or maintenance performs no database operation.
- No automatic grants, purge, hints, plan forcing, or collection-policy changes occur on panel open or empty results.

## 6. Workload overview

Use the supplied Query performance mock with these explicit semantics:

- Persistent connection/database breadcrumb and collection status.
- Summary: storage, executions, distinct queries, and selected metric total within the stated scope. Define “queries” as distinct scoped query IDs, not grid rows or SQL strings.
- Time presets plus custom window, timezone label, metric, aggregation, and optional baseline comparison.
- Chart title states metric and aggregation: for example **Total duration by interval** or **Average CPU per execution**.
- Trend supports zoom/selection where useful; the selected window updates both list and details consistently.
- Missing history renders as gaps. Incomplete intervals are visibly provisional. Do not interpolate missing periods into a zero or smooth away spikes.
- Tabs: Top consumers, Regressions, High variation, Forced & hinted, All queries.
- Filters: text/query ID, supported source classification, execution type, and wait category when meaningful. Each filter has a clear definition and affects counts/denominators consistently.
- Full SQL text remains in details; use compact previews and virtualized rows.

### Grid columns

Default: query/object label, selected-metric contribution, executions, weighted average, maximum, explicit comparison column, observed plan count, findings/actions indicators.

- Contribution bars disclose whether the denominator covers all matching queries or only the returned top-N subset.
- A query-level row aggregates its plans; expanding it exposes plan-level evidence without double-counting the query count.
- Distinguish **vs previous period** from **vs selected baseline plan**. The mock's “VS PREVIOUS PLAN” must not inherit a previous-period checkbox's meaning.
- Show unavailable comparison as “No comparable baseline,” not a blank implying no change.
- Ranking is server-side over the full supported matching set before pagination/limits. Disclose partial coverage.
- Large hashes/IDs remain exact and do not wrap into distracting paragraphs.

## 7. Query inspector

Preserve Summary / Plans / Recommendations and the selected overview context. Display database-scoped query ID, object where known, execution count, selected period, and available plan coverage.

### Summary

Lead with a measured statement, for example:

> In the selected comparison windows, average duration for Plan 9 was 4.1× Plan 4's. Lock-wait time per execution was also higher. Different workload conditions may contribute; inspect both plans and the comparison windows.

Do not state that the plan change caused the slowdown unless evidence supports that attribution. Use “first observed in retained history” for a plan marker. Multiple plans may execute concurrently; there need not be one clean switch point.

Show:

- Total and average selected metric with units/window/filter labels.
- Executions for both compared groups, not just the combined count.
- Baseline/proposed plan identities and exact window boundaries.
- Expandable query text with Copy and Open in editor.
- Per-plan timeline and an accessible table equivalent.
- Wait category comparison where supported, with explicit Total / Per execution / Share denominators.

All example numbers must be calculated from one fixture. The mock's 4.1× ratio, +314% change, per-plan means, and headline weighted average must reconcile using unrounded values. Wait sums may not equal elapsed duration; do not force them into a misleading duration breakdown.

### Plans

- List plans with observed periods, executions, weighted metrics, forcing state, and failure details.
- Select two explicit plans to compare. Do not use MAX(plan_id) to infer chronological recency or “previous good plan.”
- Reuse the repository's plan viewer where suitable; fetch full XML and reject incomplete XML as an input to rendering or findings.
- Query Store stored plans are not per-execution actual plans; do not invent actual row counts or captured parameter distributions.
- Keep variants/context/replica dimensions where supported. A query hash alone cannot safely merge different database/query identities.

### Recommendations

Each item contains observation, supporting metrics/records, interpretation limits, next check, and the applicable action.

Examples:

- Compare plans and sample volume when a duration regression is observed.
- Inspect blocking using the DMV experience when lock waits rise; clarify that current blocking cannot prove what happened in a past window.
- Inspect variation by plan and interval; do not diagnose parameter sensitivity solely from high variance.
- Review plan-forcing failures with the reported reason; do not claim an accepted force request guarantees every execution will use it.

Prioritize by measured workload contribution and absolute change as well as relative change. A huge percentage on a negligible baseline should not dominate by default.

## 8. Statistical and temporal correctness

These requirements precede diagnostic badges and charts.

### Runtime aggregation

For compatible samples with count n and average x:

- Executions = sum(n).
- Total metric = sum(n × x).
- Weighted mean = sum(n × x) / sum(n), with no-data handling for zero count.
- Maximum = maximum of the recorded compatible maxima, not maximum of interval averages.
- Do not average averages or standard deviations. Combine variance using the verified source convention and a numerically stable pooled calculation, including differences between group means. If unavailable, label a simpler measure accurately.

Aggregate runtime rows at plan/interval/execution-type and any required replica dimension before combining them. Active intervals can have multiple rows. Keep successful, aborted, and exception executions distinguishable. Microsoft documents the runtime metrics and active-interval aggregation requirements in [sys.query_store_runtime_stats](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-query-store-runtime-stats-transact-sql).

### Windows and comparisons

- Represent absolute start/end instants; capture a single reference time for relative presets.
- Define non-overlapping baseline/recent windows, timezone display, and incomplete-current-interval policy.
- Aggregated buckets cannot be sliced into exact arbitrary execution-level windows. Show effective included bucket boundaries/overlap policy and avoid pretending prorated totals are exact.
- Disclose unequal duration/coverage. Compare per-execution averages or explicitly normalized rates as appropriate.
- Distinguish no executions, absent retained history, unknown coverage, and filtered-out evidence.
- Define minimum sample and absolute/relative change thresholds as visible policy; low-confidence cases remain inspectable without an unjustified regression badge.
- Do not derive exact percentiles from averages/min/max/stdev.

### Waits

Aggregate wait rows independently by their full key, including category, before joining aligned runtime aggregates. This avoids multiplying executions across wait categories. Define compatible execution counts for per-execution waits and disclose unavailable denominators. Share is within the included wait total, not percent CPU. See [Query Store wait statistics](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-query-store-wait-stats-transact-sql).

## 9. Reviewed intervention flows

The first release includes reviewed plan forcing/unforcing and Query Store hints. Both direct Apply for authorized users and SQL generation/administrator handoff are required. Unsupported targets retain diagnosis and show why a specific intervention is unavailable.

### Force / unforce a plan

1. Select an explicit query and compatible stored plan.
2. Review database/query/plan identity, evidence windows, existing forcing/automatic tuning state, and limits of the evidence.
3. Show exact action and a corresponding unforce/reversal path; reversal is another database change, not recovery of already affected executions.
4. Recheck permissions and current state immediately before applying.
5. Execute only after explicit review, then re-read forcing state and failures.
6. Offer a follow-up observation window; do not declare the performance problem solved merely because the operation was accepted.

### Query Store hints

- Gate by actual platform/version/support and query applicability.
- Show existing hints, supported syntax, conflicts, and scope.
- Preview validated SQL and removal/replacement behavior; do not accept arbitrary unsafe concatenation into commands.
- Explain that forcing and hints can alter workload behavior; neither is an automatic response to a regression badge.
- Verify requested versus effective state and expose failure reasons.

### Explain with Copilot

Treat the mock's action as optional and separate from deterministic findings. Define the evidence sent, user-visible preview/data handling, authentication/availability, and retention expectations before implementation. SQL text may be sensitive. AI output cites the supplied observations and cannot silently apply setup, forcing, hints, or SQL.

## 10. Implementation findings to address later

These were found by reading the current source; no code is changed by this plan.

| Current behavior                                                                          | Required correction                                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| queryStoreStateSql collapses all nonzero states to is_on.                                 | Preserve desired/actual state, reasons, permissions, and coverage.                                          |
| Top consumers uses AVG(avg_duration), AVG(avg_cpu_time), and AVG(avg_logical_io_reads).   | Use execution-weighted aggregates.                                                                          |
| High variation averages interval standard deviations.                                     | Use a mathematically valid pooled calculation or a correctly named alternative.                             |
| Regression windows derive relative times in separate expressions and select MAX(plan_id). | Freeze reference time and derive plan chronology from observed evidence; support multiple plans per window. |
| Regressions use topN to obtain minimum executions.                                        | Give sample thresholds an independent validated parameter.                                                  |
| UI does not expose time-window controls despite parameterized SQL.                        | Carry a typed investigation context through request, result, chart, details, and export.                    |
| Controller warns that OFF discards all history.                                           | Separate disabling from clearing and validate platform-specific support/consequences.                       |
| Plan XML has a fixed larger bound.                                                        | Verify completeness; raising a bound is not proof of full XML.                                              |
| Generic empty result and unsupported states share weak feedback.                          | Implement readiness, collection, coverage, and actionable recovery states.                                  |

Evidence: [Query Store catalog](packages/sql-diagnostics/src/querystore/catalog.ts), [current controller](extensions/mssql/src/sqlDiagnostics/sqlDiagnosticsWebviewController.ts), and [current page](extensions/mssql/src/webviews/pages/SqlDiagnostics/sqlDiagnostics.tsx).

## 11. Package and execution architecture

Target module: `sql-feature/diagnostics/querystore`.

Internal responsibilities: capabilities/readiness, configuration model and SQL compilation, historical collectors, correct aggregation, regression/variation analysis, plan retrieval, intervention compilation, and stable finding IDs. Shared execution contracts belong in `sql-feature/core` as defined in the existing specification.

The extension owns connections, command/context resolution, localization, settings forms, charts/grids, approval/review interaction, and concrete execution. Do not put VS Code APIs or grid widths in the domain package.

Every result carries connection/database identity, time windows, metric/aggregation, execution-type/filter scope, capability/readiness snapshot, collection time, coverage, and completeness. Prevent stale responses from replacing a newer context. Serialize operations appropriately and do not interpret completedWithErrors as complete valid evidence.

Settings changes use a reviewed configuration revision. If transport fails after execution may have occurred, re-read state before retrying. Preserve unsaved form input while reconciling. Historical panels remain inspectable when configuration permissions are absent.

## 12. Delivery sequence

1. **Confirm capabilities and fixtures:** use the confirmed scope, define supported engines, reproduce mock numbers from coherent fixtures, and finalize setup/read-only/empty/recovery wireframes.
2. **Domain correctness and package boundary:** move Query Store into sql-feature, model readiness/configuration, correct aggregates/windows, and test public APIs.
3. **Setup and settings:** implement database resolution, permission handoff, guided/advanced setup, script review, recheck, drift handling, and explicit maintenance separation.
4. **Workload overview:** compact grid, real time/metric controls, chart coverage, query-level aggregation, filters, and export context.
5. **Inspector and findings:** plan comparison, wait correlation, sampled regression/variation policy, full-plan retrieval, and recommendations.
6. **Required first-release interventions:** forcing/unforcing and hints review, capability checks, verified outcomes, script/administrator handoff, and follow-up observation. Copilot is a separately scoped integration.
7. **Verification and preview rollout:** package/extension checks, real-server setup and query fixtures, accessibility, themes, and unsupported/low-permission/failure paths.

No step is authorized to execute by this document.

## 13. Acceptance scenarios

| ID  | Scenario                                                             | Expected result                                                                                                          |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Q01 | Open from master.                                                    | Explain unsupported target and offer database selection; no setup ALTER.                                                 |
| Q02 | Open an off, supported user database.                                | First-time setup surface with reviewed settings/script.                                                                  |
| Q03 | User can read history but cannot configure.                          | Diagnosis remains usable; administrator/script handoff offered.                                                          |
| Q04 | Read access is denied or inconclusive.                               | Access/unknown state, not “Query Store off” or an empty grid.                                                            |
| Q05 | Desired READ_WRITE but actual READ_ONLY.                             | Display mismatch and all relevant reasons; guided recovery.                                                              |
| Q06 | Storage is low but collection has another failure reason.            | No false healthy/collecting status.                                                                                      |
| Q07 | Cancel setup or settings.                                            | No server/settings mutation.                                                                                             |
| Q08 | Administrator changes settings after review.                         | Detect drift and require a fresh concrete review.                                                                        |
| Q09 | Setup succeeds but verification fails.                               | Distinguish accepted request from unverified collection.                                                                 |
| Q10 | Newly enabled collection has no history.                             | Explain future collection and capture policy; no backfill promise.                                                       |
| Q11 | Capture NONE/AUTO/CUSTOM omits a query.                              | Explain eligibility; no automatic broadening to ALL.                                                                     |
| Q12 | Wait capture is unavailable/off.                                     | Duration evidence remains usable; contextual explanation/setup.                                                          |
| Q13 | Filters/window exclude retained history.                             | Offer reset/available period without claiming setup failure.                                                             |
| Q14 | Runtime intervals have highly unequal counts.                        | Weighted means reconcile with total/executions.                                                                          |
| Q15 | Active interval contains multiple compatible rows.                   | Correct aggregation without loss or double counting.                                                                     |
| Q16 | Runtime data joins multiple wait categories.                         | Execution/CPU/duration totals are not multiplied.                                                                        |
| Q17 | Two groups have equal within-group stdev but different means.        | Pooled variation accounts for between-group differences.                                                                 |
| Q18 | Multiple plans overlap or IDs are out of temporal order.             | No fictitious single switch or MAX-ID previous-plan selection.                                                           |
| Q19 | Baseline is missing, tiny, or partial.                               | Explicit evidence limitation; no confident regression from an invalid ratio.                                             |
| Q20 | Compare previous period versus selected plans.                       | Labels, windows, counts, and formula follow the selected comparison mode.                                                |
| Q21 | Mock shows 4.1× and +314%.                                           | All values derive consistently from raw fixture values and stated rounding.                                              |
| Q22 | Chart has missing/provisional intervals.                             | Gaps and partial status, not fabricated zeroes or smooth continuity.                                                     |
| Q23 | Query text/plan XML is incomplete or contains markup.                | Safe rendering; no invalid plan analysis presented as complete.                                                          |
| Q24 | User switches target/window during load.                             | Old results never appear under the new context.                                                                          |
| Q25 | Review forcing, then cancel.                                         | No plan state changes.                                                                                                   |
| Q26 | Force request accepted but later application fails.                  | Failure surfaced; no claim of resolved regression.                                                                       |
| Q27 | Hint capability absent.                                              | Explanation without offering invalid mutation syntax.                                                                    |
| Q28 | Clear history, disable, and flush are available.                     | Separate reviewed actions and accurate consequences, outside settings Save.                                              |
| Q29 | Keyboard/high-contrast/screen reader use.                            | Setup, charts, evidence, inspector, and recovery are usable.                                                             |
| Q30 | Export after changing filters.                                       | Export describes the same snapshot, units, windows, and coverage as the view.                                            |
| Q31 | sql-feature Query Store tests run without VS Code.                   | Domain package remains independent of UI/host APIs.                                                                      |
| Q32 | Copilot unavailable or declined.                                     | Deterministic diagnosis remains functional; no silent data transfer.                                                     |
| Q33 | Invoke the dedicated Query Store command or database context action. | Opens a standalone Query Store panel directly, including setup when needed, without navigating SQL Diagnostics or Agent. |

## 14. Validation and open design work

Use package tests for configuration compilation, state decoding, weighted/pooled metrics, window handling, evidence rules, and identifier validation. Use extension tests for command scope, review/drift/verification, stale responses, and error recovery. Real-server tests should cover supported versions/platforms, low permissions, setup, read-only states, normal/aborted executions, multiple plans, and forcing/unforcing and hint outcomes on supported targets.

Render and inspect each key state against fixtures: off, wrong database, denied, read-only, newly collecting, filtered empty, populated overview, insufficient baseline, settings diff, plan comparison, maintenance confirmation, and failed verification. Reuse FluentSlickGrid and repository charts/plan-viewer capabilities; virtualize long lists. Localize all user-facing copy and provide text alternatives to charts.

Outstanding implementation-design decisions beyond the confirmed product choices: initial engine/version matrix; guided default values; minimum evidence policy; source-filter definition; plan-viewer reuse capabilities; and optional Copilot integration/data handling. Resolve these before implementation rather than embedding unreviewed assumptions into production behavior.
