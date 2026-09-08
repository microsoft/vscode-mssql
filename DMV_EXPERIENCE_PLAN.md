# DMV Experience and Package Separation Plan

Status: Planning only. No implementation or database changes are authorized by this document.

Date: 2026-09-07

Companion specification: [TABLE_EDITOR_SPEC.md](TABLE_EDITOR_SPEC.md), especially section 17 on the `sql-feature` package.

## 1. Product direction

Create a dedicated experience for investigating SQL Server activity using DMVs. Move its engine out of `sql-diagnostics` into the agreed `sql-feature` package and expose a separate command. Make results understandable through summaries, visual comparisons, explanations, and concrete investigation steps.

The experience must answer:

1. Can I collect the evidence I need? If not, what must be configured or requested?
2. What did this sample actually observe, and over what period and scope?
3. Which observations deserve investigation, and why?
4. What evidence supports that interpretation?
5. What should I inspect or measure next?

Do not reduce the product to a menu of SQL scripts and raw tables. Do not replace the raw evidence with unsupported diagnoses either.

### Confirmed requirements

- Separate DMV from the existing combined SQL Diagnostics experience.
- Introduce its own command entry point.
- Use `sql-feature` as the destination package; do not create a separate `sql-dmv` package.
- Improve presentation and digestibility, especially long SQL text and large cumulative metrics.
- Help users interpret the evidence and pursue a diagnosis.
- Help users configure missing prerequisites instead of showing empty data.
- Prepare plans only at this stage.

### Proposed defaults

- User-facing name: **SQL Activity**.
- Command Palette: **MS SQL: Open SQL Activity (DMV)**.
- Command ID: `mssql.sqlActivity.open`.
- Default landing: Overview, with readiness checks and a timestamped initial sample.
- Investigation is read-only by default. Configuration changes require explicit user action after review.
- Start with deterministic, testable interpretations. An AI service is not a dependency for basic explanations.

## 2. Problems visible in the current experience

| Observation                                                                      | Why it impairs diagnosis                                                              | Planned change                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Active requests returns zero rows and shows only “No rows returned.”             | Users cannot distinguish idle workload, limited visibility, or a failed prerequisite. | Separate readiness, execution outcome, and successful empty sample states.                                 |
| Extended Events stream readers dominate total-duration rankings.                 | Long elapsed time can be mistaken for expensive application work.                     | Identify likely monitoring activity with supporting evidence; compare CPU, reads, and execution frequency. |
| Full SQL text expands individual rows to hundreds of pixels.                     | Comparing records becomes difficult and important metrics leave the viewport.         | Compact fixed-height rows with a separate full-text/details inspector.                                     |
| Wait totals reach millions of seconds.                                           | Cumulative multi-task totals look like current outage duration.                       | Label the observation window, use readable units, and support interval measurements.                       |
| Internal/background waits dominate the ranking despite an exclusion description. | The largest number distracts from useful workload evidence.                           | Explain classification and let users inspect included/excluded waits; unknown waits remain visible.        |
| An unsupported database-waits variant occupies navigation on SQL Server.         | Users encounter a disabled implementation variant rather than a coherent feature.     | Offer one Waits investigation and select the supported scope/collector underneath.                         |
| The selected diagnostic can change while the old result remains visible.         | Evidence can appear to belong to the wrong question.                                  | Bind heading, results, parameters, timestamp, and interpretation to one snapshot identity.                 |
| Durations, counts, hashes, and SQL have similar visual weight.                   | Users must discover the important columns themselves.                                 | Lead with the relevant metric, expose secondary values through details, and retain all raw data.           |

These are design findings from screenshots and inspected source. They do not establish the cause of a live performance incident.

## 3. Package and ownership plan

### Target ownership

```text
packages/sql-feature/
  src/
    core/                         Shared execution, values, outcomes, capabilities
    diagnostics/
      dmv/
        collectors/               Requests, blocking, query stats, waits, file I/O, indexes
        snapshots/                Scope, timing, identity, baseline compatibility
        analysis/                 Evidence-backed findings and comparison rules
        guidance/                 Stable guidance IDs and applicability rules
        index.ts                  Public feature API
```

Public imports:

- `sql-feature/core`
- `sql-feature/diagnostics/dmv`

DMV must not depend on `sql-diagnostics`. Shared infrastructure needed by both moves into `sql-feature/core`, with temporary compatibility exports if needed. Do not duplicate core implementations or create circular dependencies.

### Package responsibilities

- Collector SQL and parameter validation.
- Platform/version/scope applicability and permission requirements.
- Typed metric values, units, collection timestamps, and completeness.
- Snapshot comparison, counter-reset detection, and finding generation.
- Stable finding/guidance identifiers with supporting data.

### Extension responsibilities

- Connection selection and identity, session ownership, and command registration.
- Concrete data-plane adapter and session operation coordination.
- Localized labels, explanations, setup steps, and presentation.
- Grids, charts, details panes, clipboard/export, and opening SQL.
- User review and execution of explicitly requested configuration changes.

The broader consolidation of editing, Query Store, profiling, and Agent remains in the companion specification. This DMV tranche must not require unrelated feature redesigns. SQL Agent and Query Store stay reachable through their existing entry points during migration.

## 4. Entry points and navigation

### Command behavior

1. Resolve the selected Object Explorer connection/database when invoked from that context.
2. Otherwise offer the existing connection picker; cancellation exits without an error.
3. Key panels by connection identity plus applicable database scope. Never use a friendly server label as identity.
4. Reuse a compatible open panel; do not accidentally reuse a panel for a different database or authentication context.
5. Open Overview, run bounded readiness checks, and collect supported initial evidence.

Plan Object Explorer actions for both server and database nodes. The panel must always show its collection scope. A server-scoped DMV must not be labeled as database-scoped simply because the connection's current database is `master`.

### Navigation

- **Overview** — readiness, sampled observations, and recommended investigations.
- **Requests and blocking** — active requests, blocking relationships, and transaction context where available.
- **Query workload** — one view with Duration / CPU / Logical reads ranking controls.
- **Waits** — categorized waits and interval comparison.
- **Storage I/O** — file-level latency and volume.
- **Index candidates** — estimated opportunities with workload validation guidance.

Use short navigation labels. Put explanations at the top of the selected investigation rather than repeating paragraphs in the sidebar.

## 5. Overview and diagnostic workflow

```text
SQL Activity     connection / server / database or server scope

[Readiness: 4 available · 1 needs permission] [Review setup]
[Refresh] [Start observation]                   Collected at 15:42:08

Observed in this sample
  3 blocked requests          1 visible head blocker
  Cached workload             Historical totals; interval not collected
  Storage                     Permission needed [Review setup]

Recommended investigation
  Blocking observed → Inspect blocker and affected requests [Open blocking]
  Event-stream readers present → Separate monitoring from application workload

Requests & blocking | Query workload | Waits | Storage I/O | Index candidates

Compact evidence grid                 Selected record / explanation / next steps
```

Cards show measured quantities or explicit readiness states. Do not invent a global health score. A failed collector produces unavailable evidence, not a zero. A partial Overview remains usable and identifies which observations are missing.

Each finding must provide:

- **Observed:** a measured fact tied to a snapshot and affected records.
- **Meaning:** a bounded explanation, with uncertainty where appropriate.
- **Next check:** a concrete investigation or measurement.
- **Evidence:** links/focus actions to the relevant records and source SQL.

Example: “3 requests are blocked by session 52 in this sample. Inspect its transaction and application before deciding how to resolve the blockage.” Do not infer that session 52 is defective or safe to terminate.

## 6. Readiness and guided setup

### State model

Readiness is per collector or capability, not one all-or-nothing gate for the panel.

| State                   | Meaning                                                          | User action                                                                |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Checking                | Requirements are being evaluated.                                | Wait or cancel collection.                                                 |
| Ready                   | Requirements checked so far permit collection.                   | Collect evidence.                                                          |
| No connection           | No usable target selected.                                       | Connect / Choose connection.                                               |
| Data-plane setup needed | Required extension execution path is disabled/unavailable.       | Open the relevant setting or guided setup, then reconnect if necessary.    |
| Permission needed       | Permission denial is established by a check or execution result. | Review permission requirement and administrator request/script.            |
| Unsupported             | This engine/version/scope cannot provide the collector.          | Choose a supported alternative or inspect the explanation.                 |
| Configuration needed    | A relevant optional source is supported but not configured.      | Review exact setup and implications.                                       |
| Visibility limited      | Only a subset of evidence may be visible.                        | Explain the limit and how to request broader access.                       |
| Ready, no matching data | Collection succeeded with no matching rows.                      | Explain sample semantics and offer another observation.                    |
| Collection failed       | Execution/network/service failure occurred.                      | Show details and appropriate retry/reconnect action.                       |
| Readiness unknown       | A check could not establish a prerequisite.                      | Explain uncertainty; do not assert permission or configuration is missing. |

### DMV-specific principle

Most DMV investigations do not have a generic “enable DMV” switch. Never offer a setup wizard that claims to populate data simply by enabling DMVs. Empty activity can be a valid observation. Cache eviction and counter resets can remove accumulated evidence. Explain these separately from configuration.

### Setup interaction

1. State what is missing and which investigation it affects.
2. Explain why it is needed and which scope/principal it applies to.
3. Offer an appropriate action: Open settings, Connect, Review SQL, Copy administrator request, or a supported alternative.
4. For a configuration change, show the exact target, script/action, required authority, effects, and any ongoing collection/resource implications.
5. Require an explicit Apply action for that concrete change. Opening a diagnosis does not grant permission to change server settings or privileges.
6. Execute only when supported and authorized; otherwise retain a reviewable script/request for an administrator.
7. Recheck readiness and recollect affected evidence after completion. If the user runs a script elsewhere, offer Recheck.
8. Preserve the original diagnostic context and report setup failures without losing other evidence.

Permissions must be chosen for the actual engine, version, and scope. Do not hardcode one legacy permission for every SQL Server and Azure target. Do not automatically grant permissions or recommend broad administrator roles as the default solution.

### Optional adjacent sources

When a question needs historical evidence that current DMVs cannot supply, offer **Open Query Store**. If Query Store is supported but off, hand off to a reviewed setup flow explaining collection mode, storage/retention, scope, and required privileges. Do not silently enable it merely to satisfy a DMV view.

If deeper investigation needs Extended Events, offer an explicit profiling workflow that explains session scope and collection cost. Treat SQL Agent availability as relevant only to an Agent workflow, not as a prerequisite for DMV activity.

### Empty-state examples

- Active requests: “No matching user requests were visible at collection time. Start an observation while reproducing the issue.” Limited visibility, if known, is disclosed separately.
- Blocking: “No blocking relationships were observed in this sample. Intermittent blocking may require repeated observation.”
- Query workload: “No matching completed statements were returned from the current plan cache. Refresh after the workload finishes, or use Query Store for retained history.”
- Index candidates: “No matching candidates were returned. This does not establish that existing indexes are optimal.”
- Wait comparison: “Baseline collected. A second compatible sample is needed to calculate interval waits.”

Empty data never triggers automatic workload generation, configuration changes, or fabricated sample results.

## 7. Presentation by investigation

### Requests and blocking

- Compact request rows: session/request identity, status, elapsed, CPU, current wait, blocked-by, application, database.
- Represent blocking as an expandable relationship tree with affected-request counts and wait context.
- Distinguish a session from a request; account for multiple requests per session where the server supports them.
- Include sleeping blockers when supported; a blocker can have an open transaction without an active request.
- Handle negative/special blocker identifiers, missing/invisible parents, cycles, and depth/collection bounds explicitly.
- Inspector: full statement, application/login context, transaction details when collected, and suggested next checks.
- Do not offer automatic KILL as remediation. Any future termination action requires a separate reviewed operation with impact context.

### Query workload

- Combine duration/CPU/reads into one ranking selector.
- Lead with short statement preview, selected total metric, executions, and per-execution cost.
- Display plan creation/collection context and explain that cached plans have different lifetimes.
- Use horizontal bars only with an explicit denominator such as “share of returned top 50”; never label that as whole-server share.
- Treat query hash as a grouping hint, not a unique statement/plan/database identity.
- Identify likely monitoring readers from narrow evidence and label the classification as such. SQL text matching alone is not authoritative ownership attribution.
- Provide a visible Include monitoring activity control if exclusion is supported. Exclude before ranking/limiting where possible; otherwise disclose that filtering an already capped result may hide useful lower-ranked records.
- Keep long SQL and query/plan hashes in details. Provide Copy statement and Open diagnostic SQL as separate actions.
- High total duration alone does not prove high CPU consumption, blocking, or a poorly optimized query.

### Waits

- Default investigation should support a measured interval. Until a baseline and second compatible sample exist, show cumulative totals with an explicit label.
- Group documented wait families such as locking, CPU scheduling, I/O, logging, memory grants, and parallelism; keep unknown waits visible.
- Include an explanation and evidence-based next check for selected wait types/families. Avoid universal root-cause claims from a wait name.
- Show common background/internal classifications separately and allow inclusion. Retain the exclusion policy/version with the snapshot.
- Wait share refers to the included wait-time denominator. It is not CPU utilization, wall-clock duration, or a fraction of individual request runtime.
- Compute interval totals from raw counters before ranking. Do not subtract two independently truncated top-N result sets.
- If counters reset, identities change, or a sample is incomplete, invalidate the comparison and request a fresh baseline.

### Storage I/O

- Group by database/file and separate data/log files.
- Display read latency with read count and write latency with write count; zero operations produces “Not measured,” not 0 ms.
- Preserve fractional precision and format long durations readably.
- Prefer interval averages derived from delta stall time / delta operation count. Never subtract cumulative averages.
- Explain when a small operation count or cumulative history limits interpretation.
- Suggest correlated checks rather than declaring storage defective from one number.

### Index candidates

- Group candidates by target table; show suggested equality/range/include columns in details.
- Label impact as an optimizer estimate and the ranking score as a heuristic.
- Include usage evidence and relevant collection limits.
- Next steps: inspect existing indexes, compare overlapping candidates, inspect affected plans, measure representative reads and writes.
- No automatic CREATE INDEX or blanket apply-all action.

## 8. Shared grid, details, and formatting

- Use FluentSlickGrid and repository virtualization patterns.
- Fixed compact row heights, resizable columns, numeric alignment, and predictable keyboard navigation.
- One- or two-line SQL preview with full content in a resizable inspector; no multi-screen grid rows.
- Preserve selection where the same record can be safely identified across refresh. Otherwise explain/reset selection rather than showing unrelated details.
- Show collection time, scope, row cap/completeness, filters/exclusions, and elapsed collection duration separately from workload timing.
- Show days/hours/minutes where they aid comprehension, with exact numeric values and units available in details/export.
- Treat NULL, unavailable, not measured, and zero as different values.
- Preserve raw precision; do not round before calculations.
- Provide Summary / Evidence / SQL access without forcing users to abandon the investigation.
- CSV/report exports include scope/window/filter/completeness metadata through a companion metadata section/file or an explicitly defined export format.
- Findings and exports refer to the same captured snapshot; they do not silently mix data collected at different times.

## 9. Collection and interpretation contract

A snapshot carries collector ID/version, connection identity, server/database scope, parameters, start/end timestamps, capability/permission observations, rows, units, source completeness, row limit, exclusions, and relevant reset/plan-generation identifiers.

A finding carries a stable rule ID/version, observation category, supporting record references/metrics, applicability, uncertainty/limitations, and allowed next-step identifiers. Localized text is rendered in the extension rather than baked into SQL result strings.

- Serialize operations on sessions with one-active-query constraints.
- Coalesce refresh requests and ignore stale responses. Never overlap refresh loops indefinitely.
- Cancel/dispose sessions and retained results correctly when panels close.
- Treat completedWithErrors as incomplete/failed evidence; do not interpret it as a successful empty result.
- Bound collection and rendering costs and disclose truncation/caps.
- Stop automatic observation when the user pauses/closes it; make cadence and active state visible.
- Avoid enabling heavy collectors as a side effect of Overview. Initial collectors and cadence need explicit cost review.
- Do not claim all Overview collectors describe one transactionally consistent instant when they are collected sequentially.
- Test inference rules against counterexamples. No arbitrary universal red/yellow thresholds without a documented basis and workload caveat.

## 10. Accessibility, localization, and diagnostic privacy

- Localize headings, findings, setup instructions, states, and parameterized counts through repository localization sources.
- Announce readiness and collection outcomes without reading every refreshing cell.
- Make navigation, setup review, evidence selection, charts, and details keyboard accessible.
- Provide text equivalents for charts and avoid color-only severity distinctions.
- Verify dark, light, high-contrast, narrow layouts, and zoom.
- SQL text, connection names, identities, and values are potentially sensitive: do not place them in telemetry.
- Record bounded operational metadata such as collector/rule IDs, duration, outcome categories, completeness, and setup-step results.

## 11. Delivery plan

### Phase 1: Architecture and standalone entry

- Inventory DMV/core consumers and existing package tests.
- Establish sql-feature public entry points and move DMV ownership.
- Extract genuinely shared infrastructure without duplicating it or migrating unrelated UI.
- Add the standalone command, connection/scope identity, panel lifecycle, and remove DMV from the combined diagnostics tabs.
- Preserve access to Query Store and Agent.

### Phase 2: Readiness and collection correctness

- Implement per-collector readiness and structured execution outcomes.
- Add connection/data-plane/permission/unsupported/setup/empty states and contextual actions.
- Correct stale result labeling, queueing, and completeness reporting.
- Define version/scope-specific permission checks and reviewable administrator requests.

### Phase 3: Digestible evidence

- Replace tall raw tables with compact virtualized grids and details.
- Group navigation by diagnostic question.
- Add correct units, observation-window labels, caps, and export metadata.
- Add view-appropriate comparisons and charts.

### Phase 4: Interpretation and observation

- Add tested evidence-backed findings and next-step actions.
- Add blocking representation, monitoring context, wait-family guidance, and index/storage caveats.
- Add compatible baseline/interval collection with reset detection.
- Add setup handoffs for optional historical/profiling sources.

### Phase 5: Verification and rollout

- Run package/extension lint and tests, real-server integration, and rendered UI/accessibility checks.
- Verify low-permission, unsupported, empty, error, partial, and setup-completion paths as deliberately as populated results.
- Keep preview rollout until supported-platform acceptance scenarios pass; document remaining unsupported cases.

## 12. Acceptance scenarios

| ID  | Scenario                                                           | Required result                                                                     |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| D01 | Open from Command Palette without a connection.                    | Actionable connection flow; cancellation is not an error.                           |
| D02 | Open from a database node.                                         | Correct connection/database scope is retained and displayed.                        |
| D03 | Open panels with identical display names but different identities. | No accidental panel/session reuse.                                                  |
| D04 | Required data-plane setting is off.                                | Guided setting/reconnect action, not an empty table.                                |
| D05 | DMV execution is denied.                                           | Accurate permission/scope explanation and reviewable setup request.                 |
| D06 | Readiness cannot be established.                                   | Unknown state, not a guessed missing permission.                                    |
| D07 | Platform lacks a collector.                                        | Explain unsupported status and offer a valid alternative when available.            |
| D08 | Query succeeds with zero rows.                                     | View-specific explanation; no claim of global health or missing setup.              |
| D09 | One Overview collector fails.                                      | Other evidence remains usable; failed metric is not zero.                           |
| D10 | Select another investigation before a query finishes.              | Late results never appear under the new heading.                                    |
| D11 | Server returns completion with errors.                             | No false successful/empty sample.                                                   |
| D12 | Long SQL contains markup-like text.                                | Safely rendered compact preview and exact details, without injected HTML.           |
| D13 | Event-stream readers dominate duration.                            | Monitoring context and CPU/reads comparison; no automatic slow-application verdict. |
| D14 | Top-N results are filtered.                                        | Cap, exclusions, and chart denominator remain explicit.                             |
| D15 | A sleeping session blocks active requests.                         | Relationship is represented or missing context is disclosed.                        |
| D16 | Blocking includes cycles/special identifiers/invisible parents.    | No endless traversal or fabricated head-blocker identity.                           |
| D17 | Wait counter resets between samples.                               | Delta invalidated; new baseline required.                                           |
| D18 | An unknown wait dominates the sample.                              | It remains visible without an invented diagnosis.                                   |
| D19 | File has zero reads and some writes.                               | Read latency is not measured; write latency uses the correct denominator.           |
| D20 | Cached plans are evicted/recompiled.                               | No false interval match based only on query hash.                                   |
| D21 | Missing-index candidate has high estimated impact.                 | Validation guidance; no automatic index creation.                                   |
| D22 | User reviews setup but cancels.                                    | No settings/privilege/database change.                                              |
| D23 | Administrator applies a reviewed setup elsewhere.                  | Recheck updates readiness and recollects the affected view.                         |
| D24 | Optional Query Store source is off.                                | Explain historical-evidence limitation and offer an explicit reviewed handoff.      |
| D25 | User navigates entirely by keyboard/screen reader.                 | Setup, evidence, findings, details, and refresh are operable.                       |
| D26 | Close during observation.                                          | Collection stops and resources are released.                                        |
| D27 | Import DMV from the new package.                                   | No reverse dependency on sql-diagnostics or VS Code.                                |
| D28 | Export evidence after a filter/window change.                      | Exported rows, interpretation context, and metadata describe the same snapshot.     |

## 13. Decisions to settle before implementation

1. Confirm **SQL Activity** versus **DMV Explorer** as the user-facing name; keep “DMV” searchable in the command either way.
2. Choose the initial supported engine/version matrix and readiness checks per collector.
3. Choose observation cadence and whether continuous observation is in the first preview. Manual snapshot plus explicit baseline/compare is a lower-cost initial option.
4. Decide whether configuration helpers only generate scripts initially or also execute reviewed, authorized changes for qualified users.
5. Decide the initial Overview collector budget and how much blocking/transaction context to collect on demand.
6. Define report/export metadata format and retention policy for local snapshots.

These are product/implementation decisions, not authorization to start implementing this plan.

## 14. Technical references

- [SQL Server cached query statistics](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-query-stats-transact-sql): completed-execution statistics tied to cached-plan lifetimes; this limits historical interpretation and comparison.
- [SQL Server wait statistics](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-wait-stats-transact-sql): cumulative counters, reset behavior, wait descriptions, and permission requirements.
- [Missing index details](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-db-missing-index-details-transact-sql): source semantics and limitations to verify when implementing candidate presentation.
- Current collector: [DMV catalog](packages/sql-diagnostics/src/dmv/catalog.ts).
- Current controller: [SQL Diagnostics webview controller](extensions/mssql/src/sqlDiagnostics/sqlDiagnosticsWebviewController.ts).
- Current UI: [SQL Diagnostics page](extensions/mssql/src/webviews/pages/SqlDiagnostics/sqlDiagnostics.tsx).
