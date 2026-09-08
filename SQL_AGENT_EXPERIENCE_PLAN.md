# SQL Server Agent: Jobs, Creation, and History Experience Plan

Status: Draft for review. Planning only; no feature implementation, job execution, or server configuration changes are authorized.

Date: 2026-09-07

Companions: [DMV plan](DMV_EXPERIENCE_PLAN.md), [Query Store plan](QUERY_STORE_EXPERIENCE_PLAN.md), and [sql-feature architecture](TABLE_EDITOR_SPEC.md#17-sql-feature-package-architecture).

## 1. Product goal

Deliver a complete, polished workflow for discovering jobs, creating and scheduling them, monitoring execution, and diagnosing failed or unexpected outcomes. SQL Server Agent should feel like one coherent job-management experience rather than separate catalog queries and a minimal create dialog.

“Agent” in this document means SQL Server Agent, not AI agents. The target package entry point is `sql-feature/agent`.

### Confirmed requirements

- Create a plan and ask questions; do not implement it.
- Finish and polish job creation, job listing, and execution history.
- Include setup, permission, unsupported-platform, empty, and recovery experiences consistent with the other plans.

### Product questions asked; answers pending

| Question           | Proposed planning default                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Job-creation depth | Multiple T-SQL steps, schedules, and advanced execution options.                              |
| Management actions | Create, edit, run, stop, enable/disable, delete, and generate SQL.                            |
| Platform scope     | SQL Server and Azure SQL Managed Instance Agent; Elastic Jobs is a separately scoped product. |

These are assumptions for this draft, not accepted decisions. Developer-friendly guidance with administrator handoff is proposed for consistency with the Query Store experience; Agent-specific action permissions must still be checked.

### Required separate entry point

Confirmed requirement: SQL Server Agent has its own command registration (`mssql.sqlAgent.open`), independently accessible panel, and public package entry point (`sql-feature/agent`). It must not require opening the combined SQL Diagnostics panel or another feature first.

- The command is discoverable directly in the Command Palette; contextual actions resolve the appropriate connection/scope.
- Opening without prerequisites leads to this feature’s own connection/setup/readiness experience.
- Opening one feature does not initialize unrelated feature collectors or configuration flows.
- Cross-feature investigation links are optional shortcuts, not the sole entry path.

- Command Palette: **MS SQL: Open SQL Server Agent** (`mssql.sqlAgent.open`).
- Object Explorer server action: **SQL Server Agent jobs**.
- Optional job-node actions open the same job details/history experience.
- Remove Agent from the combined diagnostics tabs when the standalone experience is ready; preserve discoverability during migration.
- Jobs belong to the Agent instance, not the query editor's current database. Each step's database context is displayed separately.

## 2. Experience structure

```text
SQL Server Agent                         instance / connection identity
Service: Running · Visibility: Your jobs                 [Review access]

[New job] [Refresh] [Search jobs…] [Status] [Owner] [Category]
All jobs | Running | Last run failed | Disabled

JOB                 CURRENT      LAST OUTCOME     LAST RUN     NEXT RUN
Nightly load        Idle         Failed           02:00        Tomorrow 02:00
  Warehouse load · 3 steps · Daily schedule

Selected job: Nightly load                 [Run…] [Edit] [More]
Overview | Steps | Schedules | History | Notifications

Last run failed at step 2: Load staging
[Inspect failure] [Open step SQL] [View execution history]
```

Use a compact virtualized jobs grid with a resizable details area or full-width job details view. Preserve search, sort, filters, selection, and scroll when entering history and returning. Long commands and error messages live in the inspector, not tall grid cells.

The top-level list should immediately answer: what is running, what failed last, which jobs are disabled, and what is expected to run next. These are separate facts: a job can be enabled, currently running, and have a failed previous outcome simultaneously.

## 3. Setup and readiness

| State                       | User-facing explanation                                                                   | Action                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No connection               | Choose an Agent-capable target                                                            | Connect / Choose connection                                        |
| Unsupported engine/edition  | Agent is unavailable here                                                                 | Explain supported alternatives; do not show a Start Agent button   |
| Service running             | Execution may be available, subject to permissions                                        | Browse/create/run as allowed                                       |
| Service stopped             | Existing definitions/history may remain readable, but scheduling/execution is unavailable | Show platform-specific administrator guidance and Recheck          |
| Service status unknown      | Current principal cannot establish service state                                          | Explain uncertainty; retain independently available job operations |
| Insufficient job visibility | Some or all jobs may be hidden by permissions                                             | Review access / Copy administrator request                         |
| Cannot create/modify/run    | The specific action is not permitted                                                      | Continue read-only work or generate supported SQL for review       |
| No visible jobs             | No jobs returned within the established visibility scope                                  | New job if allowed / Review access                                 |
| No filter matches           | Jobs exist but current filters exclude them                                               | Reset filters                                                      |
| Collection failed           | Network/backend/server error                                                              | Retry or reconnect with details                                    |

SQL Agent permissions depend on role, ownership, and operation. Do not treat membership in one role as blanket permission to manage every job. Explain “Your jobs” versus broader visibility where established; do not claim the server has no jobs merely because the result is empty. Microsoft documents the distinctions in [SQL Server Agent fixed database roles](https://learn.microsoft.com/en-us/ssms/agent/sql-server-agent-fixed-database-roles).

### Setup boundaries

- Opening the panel never starts a service, grants a role, creates an operator/proxy, or changes scheduling.
- Service configuration guidance must match SQL Server on Windows/Linux and managed-service capabilities. Never pretend a SQL connection automatically grants operating-system service control.
- Do not require access to a service-status DMV as a prerequisite to every job view if another authorized path works.
- Show an exact target-specific administrator request; do not recommend sysadmin as the routine solution.
- Existing job execution identity, ownership, and proxy restrictions are preserved. No automatic owner replacement with a privileged account.
- Recheck after external setup and refresh the affected capabilities without resetting the user's draft.

## 4. Jobs list: finish and polish

### Columns and states

Default columns: name, enabled status, current activity, last completed outcome, last start, last duration, next scheduled run, and schedule summary. Owner/category become optional columns and filters. Exact job ID remains available in details.

- Key selection and actions by connection identity plus `job_id`; names can change.
- Keep current activity independent of last completed outcome.
- Distinguish requested/queued, running, retrying where known, stopping requested, idle, and unknown. Do not infer exact progress from an incomplete status source.
- Never run, no retained history, and failed history read are different states.
- Display duration in appropriate seconds/minutes/hours, including durations greater than 24 hours; retain exact values in details/export.
- Render last-run and next-run timestamps with explicit Agent/server time context. Avoid silently interpreting timezone-less server values in the client timezone.
- Multiple schedules produce a summary plus details; do not imply one schedule per job.
- Manual-only, disabled schedules, expired schedules, service unavailable, and next-run unknown have explicit labels.
- Next-run information is reported with freshness context and is not a guaranteed execution. Cached schedule metadata can lag; do not advertise an exact countdown from an unverified stale value.

### Interaction

- Search by job name/description and filter by ownership/category/enabled/current/last outcome.
- Sort using actual typed values, not formatted strings.
- Use contextual row actions on the selected job rather than a separate “job to act on” dropdown that can target a different row.
- Refresh preserves selection by job ID. If the job was removed, show that fact and disable stale actions.
- Initial scope uses single-job mutations. Bulk destructive/run actions are not implied by row multi-selection.
- Display bounded refresh cadence and pause behavior; stop observation when the panel closes.
- Show summary counts within the user's visibility/filter scope, not unqualified server-wide counts.

## 5. Job details

### Overview

Show description, owner, category, enabled state, target instance, current activity, last completed result, schedules, and configuration issues. Surface a recent failure with direct navigation to that execution's step/message.

### Steps

Display order, step name, subsystem, execution database/context, retries, and success/failure routing. Show commands in a syntax-aware read-only inspector with Copy/Open in editor.

A source field called last_executed_step_id is not automatically the current step. Branches, retries, and nonsequential step IDs make “last + 1” unreliable. Label known last-step information honestly; display a current step only when the source establishes it. [sysjobactivity](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobactivity-transact-sql) distinguishes activity timestamps and step fields.

### Schedules

Show every attached schedule, enabled state, recurrence, active period, time context, and shared-use count. Provide human-readable summaries and access to exact underlying values.

### Notifications

Display existing notification policies/operators and explain missing prerequisites. If notification editing is included, use existing authorized operators first. Creating Database Mail profiles, credentials, or operating-system infrastructure is a separate setup task with an administrator handoff.

## 6. Create-job workflow

Replace the small single-step modal with a resumable, adequately sized editor. Proposed navigation: **General → Steps → Schedule → Notifications → Review**. Simple jobs should require few fields; advanced configuration remains available without flattening everything into one form.

### General

- Required job name with duplicate-name validation scoped to the target.
- Description, category, owner where permitted, and enabled state.
- Explicit target instance and default database for T-SQL steps; do not silently fall back to master when the selected database is missing.
- Proposed initial default: create disabled, with a clearly reviewed Enable on creation choice. Product review should settle this; enabling a schedule can cause execution soon after creation.
- Manual-only jobs are valid. A schedule is not required to create a runnable job.

### Steps

- Add, edit, reorder, duplicate, and remove steps using stable local IDs.
- T-SQL editor with database selection, exact command preservation, and appropriate syntax highlighting.
- Explicit starting step, success/failure route, retry count, and retry interval.
- Defaults: proceed to the next step on success, end with success at the final step, and end with failure on failure. Display these defaults rather than hiding them in generated SQL.
- Validate missing targets, invalid routes, unreachable steps, and potential cycles. Intentional advanced loops need explicit review, not an arbitrary prohibition.
- Reordering/removing steps updates or flags routing references; never silently redirect a failure route to a different step.
- Database/owner/proxy availability checks provide guidance but do not promise runtime access to every referenced resource.
- Do not execute step commands during validation. Parsing success is not proof a job will run successfully.
- Unsupported existing step types remain viewable and scriptable. Editing unrelated properties must not erase their metadata.

### Schedule

- Manual-only, one-time, daily, weekly, and monthly recurrence where supported.
- Start/end dates, recurrence interval, and within-day repeat controls where applicable.
- Plain-language schedule sentence and next-occurrence preview, explicitly marked as a preview with time basis.
- Validate contradictory date/time ranges and recurrence values.
- Explain daylight-saving and month-end behavior using server-specific scheduling semantics; do not apply the browser's timezone as scheduling authority.
- Adding an existing shared schedule is deliberate. Default to a job-specific new schedule unless the user selects sharing.
- Before changing a shared schedule, show affected jobs. Offer Clone for this job versus Edit shared schedule when supported/authorized.
- Agent-start/idle schedules and advanced/platform-specific behavior are capability-gated options, not guessed cron translations.

SQL Agent schedules can be shared, and reported schedule metadata has its own update behavior. Verify preview/freshness against [job scheduling](https://learn.microsoft.com/en-us/ssms/agent/schedule-a-job) and [sysjobschedules](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobschedules-transact-sql).

### Notifications and output

- Optional existing operator and notification conditions where supported.
- Explain absent mail/operator configuration and offer administrator handoff; job creation can continue without notifications if the user chooses.
- Show output destination and permissions when supported. Output files live in the execution environment, not the user's workstation by default.
- Do not embed credentials or secrets in generated scripts/telemetry.

### Review and create

Review target, job name/owner, steps, routing, schedule, enabled state, notifications, execution context, and generated SQL. Clearly state whether the job may run automatically after creation.

Actions: **Create job**, **Open SQL**, **Back**, **Cancel**. Direct execution is subject to the management-scope answer and actual permissions; SQL generation remains an administrator handoff.

- Use supported Agent procedures, not direct system-table writes.
- Treat job/steps/schedules/target attachment as one creation operation. Verify transaction behavior and stored-procedure return codes on supported targets; never leave a partially created enabled job after a failed step.
- Plan a safe staging/final-enable strategy for schedule activation and verify it with real-server tests. Do not assume a textual transaction wrapper alone guarantees all behavior.
- Preserve the draft on validation/execution failure and focus the affected field/step.
- Re-read the created job by its returned ID; “created” is not “ran successfully.”
- If acknowledgement is lost, reconcile by operation evidence before retrying; a matching name alone is not proof this operation created it.
- Success opens job details with **Run now…**, **View schedule**, and **Back to jobs**. Creation never implies a manual run.

## 7. Edit existing jobs

- Load a complete supported definition and retain a baseline revision/fingerprint.
- Show a property-level and step/schedule diff before saving.
- Recheck current server state to detect concurrent changes, rename, deletion, ownership change, or shared-schedule changes.
- Preserve unsupported properties and explicitly refuse edits that cannot round-trip safely.
- Editing command text is distinct from executing it.
- For a running job, explain supported edit timing and limitations; never claim the running execution has adopted the revised definition without evidence.
- Keep local drafts across navigation with a validated close/recovery contract; do not rely on a disposal callback as a close guard.
- Undo in the editor affects the draft only. Restoring a saved definition is a new reviewed database operation.

## 8. Run, stop, enable/disable, delete, and script

### Run

- Review selected job and start step. Starting at a later step can bypass prerequisites and does not necessarily mean “run only this step.”
- Check known current state and authority; let server validation remain authoritative for races.
- Report **Start requested** when the command is accepted. Observe activity/history to establish running/completed/failed.
- Do not claim success of the job when sp_start_job returns successfully.
- A retry or rerun is an explicit new execution; prior steps may already have committed effects.

### Stop

- Identify the job/execution and explain that stopping does not undo all work already completed by the job.
- Report Stop requested until terminal state is established. Cancellation latency and external subsystems may differ.
- Do not automatically stop unrelated jobs or the Agent service.

### Enable/disable

- Describe scheduling impact independently from current execution. Disabling is not a synonym for stopping a running execution.
- Separate job enabled state from attached schedule enabled state; shared schedule changes can affect other jobs.

### Delete

- Review job identity, running state, history consequences, and attached/shared schedules.
- Default to preserving schedules used by other jobs. Any unused-schedule removal is explicit rather than hidden in a compiler default.
- Offer Script definition first where possible; scripting is not a guaranteed backup of history, credentials, or execution effects.

### Script

- Generate exact supported definition/changes without execution.
- Clarify creation versus alteration scripts and target context.
- Include compatible owner/schedule/context semantics and note prerequisites without disclosing secrets.
- Opening a script does not mark a create/edit operation completed.

## 9. History: executions first, step details second

The default history view is a list of job executions, not a flat mix of summary and step records.

```text
History   [Last 7 days] [Outcome: All] [Refresh] [Export]
STARTED                  OUTCOME       DURATION       STEP / SUMMARY
Sep 7, 02:00             Failed        4m 12s         Step 2: Load staging
Sep 6, 02:00             Succeeded     3m 48s         All required steps completed

Selected execution
Step 1 Extract        Succeeded  1m 20s
Step 2 Load staging   Retry      attempt 1
Step 2 Load staging   Failed     final attempt
[Full message] [Step definition] [Copy diagnostic details]
```

### History model

- Treat the job outcome summary as the execution outcome; step failure does not necessarily imply job failure because routing may handle it.
- Retain all available step attempts and retry records. Retries are not separate completed job executions.
- Preserve source history instance IDs and acquisition scope. Derive run grouping only from validated ordering/boundaries; timestamps alone are insufficient.
- History retention and pagination can omit a summary or early step. Label incomplete groups and orphan records instead of fabricating complete runs.
- Fetch older evidence in bounded pages while preserving group boundaries or explicitly loading missing details on demand.
- Live execution/activity appears separately until a reliable history association exists; history is not a live output stream.
- Never label a run successful because no failure history has arrived yet.

Job history records include packed date/time/duration and outcome information; decode with documented semantics and test edge cases. See [sysjobhistory](https://learn.microsoft.com/en-us/sql/relational-databases/system-tables/dbo-sysjobhistory-transact-sql).

### Diagnosis

Lead with the observed failure step/message, error number/severity where available, retries, and execution identity. Preserve full returned messages and signal truncation. Query additional supported output sources only when authorized and distinguish them from history text.

Offer evidence-specific next checks:

- Access denied: inspect step execution identity and target database/resource permissions.
- Missing object/database: inspect the step context and recent definition/deployment changes.
- Timeout/deadlock: correlate the time window with Query Store or DMV evidence, without claiming current activity proves a historical cause.
- Repeated failures: count failures over an explicit retained window and show example runs.
- Longer runs: compare like-for-like executions with adequate sample volume and definition context; avoid a universal “slow” threshold.

Never offer blind rerun as a guaranteed fix. “Run failed step…” must explain prerequisite and partial-work implications and use the reviewed run flow.

### Digestibility

- Status icons with text, compact timestamps, readable durations, and small outcome/duration trends.
- Charts disclose retained-window coverage and denominators. Missing runs are not assumed successes.
- Full messages use a resizable, selectable inspector, not giant grid rows.
- Keep last failure accessible even after the most recent run succeeds.
- If history is empty, distinguish never observed, retention/cleanup, filters, limited access, and failed reads. Say “No retained history” when execution history cannot be established.
- Show retention guidance and administrator handoff when needed. Purging history is a separate advanced reviewed operation, not a routine empty/error remedy.

## 10. Existing implementation findings

| Finding                                                                                   | Planned correction                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Duration aliases end in \_s but columns use duration-ms.                                  | Normalize units and add exact formatting/long-duration tests.               |
| Running-jobs view labels last executed step as current step and its date as step started. | Preserve source semantics; collect true current-step evidence if available. |
| Jobs list only returns name, not job_id.                                                  | Use stable job identity for selection, history, and mutations.              |
| Requested execution with no stop is labeled Running.                                      | Distinguish queued/requested versus start acknowledged by activity.         |
| Creation is a one-step UI with no schedules/routing/retries.                              | Add the reviewed multi-step editor according to scope answers.              |
| Multi-procedure creation has no explicit cleanup/return-code handling.                    | Verify atomic/staged creation and reconcile failures.                       |
| History mixes job summaries and steps in a capped flat table.                             | Model executions with expandable attempts and incomplete-group handling.    |
| Delete always requests unused-schedule deletion.                                          | Make schedule consequences explicit and preserve shared schedules.          |
| Permission requirement is represented as one generic role string.                         | Resolve per-operation and per-job permissions/ownership.                    |
| Names drive parameter selection and mutation targets.                                     | Preserve job_id across rename and detect stale targets.                     |

Sources: [Agent catalog](packages/sql-diagnostics/src/agent/catalog.ts), [diagnostics controller](extensions/mssql/src/sqlDiagnostics/sqlDiagnosticsWebviewController.ts), and [current UI](extensions/mssql/src/webviews/pages/SqlDiagnostics/sqlDiagnostics.tsx). These are source findings; this planning task does not run jobs or modify code.

## 11. Architecture and operation reliability

Move reusable Agent logic to `sql-feature/agent`: typed definitions, capability/permission facts, validation, schedule interpretation, history grouping, SQL compilation, and evidence rules. The extension owns connection/service integration, localization, form state, grid/details, and review/execute workflows.

- No reverse dependency on sql-diagnostics, VS Code, or UI libraries in the feature module.
- Use public `sql-feature/core` contracts for structured outcomes, exact values, completeness, and cancellation.
- Read APIs respect caller visibility; never infer “not found” from permission-denied or incomplete reads.
- Serialize session work and prevent stale history/selection responses from replacing a newer target.
- Snapshot results include connection/job identity, acquisition time, filter/window, limits, and completeness.
- Mutations carry reviewed intent and baseline state; prevent double submission and reconcile unknown outcomes.
- Agent restarts invalidate assumptions tied to the previous Agent session; historical activity must not become a phantom live job.
- Do not log command text, credentials, output, or connection/user identifiers in telemetry. Record bounded action/outcome metadata.

## 12. Polish and accessibility completion criteria

- Reuse FluentSlickGrid, existing virtualization, SQL editors, and design tokens.
- Persistent filter/selection state, predictable keyboard navigation, visible focus, and focus restoration after dialogs/actions.
- Accessible step reordering with explicit Move up/down alternatives to dragging.
- Error summaries link to fields and steps; validation does not reset the draft or dismiss the form.
- Localize all visible copy, labels, status, schedule summaries, and parameterized counts using repository sources.
- Verify light, dark, high contrast, zoom, and narrow window layouts.
- Announce action outcomes without reading every polling update; no false completion toast.
- Handle loading, permission, unsupported, empty, stale, partial, and error states as designed screens.
- Keep dangerous actions out of the primary happy path while preserving discoverability in contextual menus.

## 13. Delivery sequence

1. Confirm creation/action/platform scope and define populated/empty/setup/history fixtures.
2. Establish sql-feature/agent boundaries, stable IDs, units, capabilities, and history model.
3. Implement standalone list/details and readiness with truthful live/last-result states.
4. Implement create/edit drafts, schedules/routing validation, review/script, and safe verified creation.
5. Finish execution-oriented history, step attempts/messages, navigation, and diagnostic next checks.
6. Complete approved management actions with reviewed intent and outcome reconciliation.
7. Validate supported SQL Server/Managed Instance behavior, role/ownership cases, restart/retention/race cases, and UI accessibility/performance before preview completion.

This sequence is a plan, not authorization to execute any phase.

## 14. Acceptance scenarios

| ID  | Scenario                                                     | Required result                                                                                                                         |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| J01 | Agent unavailable on target.                                 | Explain platform limitation; no misleading empty jobs list or service-start action.                                                     |
| J02 | Service status cannot be read but jobs can.                  | Jobs remain usable; status is Unknown.                                                                                                  |
| J03 | User sees only owned jobs.                                   | Scope disclosed; actions reflect actual ownership/permissions.                                                                          |
| J04 | Service stopped with existing history.                       | Retained evidence remains readable where authorized; setup guidance provided.                                                           |
| J05 | Rename a selected job.                                       | Selection and actions continue by job_id or explicitly reconcile.                                                                       |
| J06 | Creation fails halfway through steps/schedules.              | No unnoticed partially enabled job; preserve draft and verify cleanup/outcome.                                                          |
| J07 | Lose acknowledgement after create.                           | Reconcile before retry; no blind duplicate creation.                                                                                    |
| J08 | Reorder/delete a referenced step.                            | Routing updated deliberately or validation blocks ambiguous references.                                                                 |
| J09 | Job has a shared schedule.                                   | Affected jobs shown before change; clone option where supported.                                                                        |
| J10 | Manual-only or expired schedule.                             | Accurate next-run label; no fabricated timestamp.                                                                                       |
| J11 | Schedule metadata stale or timezone uncertain.               | Freshness/time basis disclosed; no exact false countdown.                                                                               |
| J12 | Cancel creation/edit/review.                                 | No server mutation and draft handling follows the documented choice.                                                                    |
| J13 | Start command accepted before execution begins.              | Start requested, not job succeeded.                                                                                                     |
| J14 | Run from an intermediate step.                               | Review bypassed prerequisites and subsequent routing.                                                                                   |
| J15 | Stop requested.                                              | Observe actual termination; no claim all effects were rolled back.                                                                      |
| J16 | Disable a running job.                                       | Do not imply it was stopped.                                                                                                            |
| J17 | Agent restarts during observation.                           | Old-session activity does not remain falsely Running.                                                                                   |
| J18 | Last executed step is not current step.                      | Correct source label; no last+1 inference.                                                                                              |
| J19 | 90-second or 26-hour history duration.                       | Correct units and readable duration.                                                                                                    |
| J20 | Step fails but routing produces job success.                 | Show both accurate step and job outcomes.                                                                                               |
| J21 | Step retries twice.                                          | Attempts grouped with the execution; not three completed jobs.                                                                          |
| J22 | History page/retention cuts through an execution.            | Incomplete run disclosed and older evidence requested where available.                                                                  |
| J23 | History is absent.                                           | No unproven “never ran” or success claim.                                                                                               |
| J24 | Error message/command contains markup or is truncated.       | Safe rendering and completeness indication.                                                                                             |
| J25 | Concurrent job/schedule edit occurs.                         | Baseline conflict shown before overwriting.                                                                                             |
| J26 | Edit a job with unsupported subsystem properties.            | Preserve them or refuse unsupported edit without destructive round-trip.                                                                |
| J27 | Delete job with shared schedules.                            | Shared dependencies preserved; exact consequences reviewed.                                                                             |
| J28 | Filter/switch job during history fetch.                      | Late response cannot appear under the wrong job.                                                                                        |
| J29 | Keyboard/screen reader/high-contrast workflow.               | Creation, reordering, review, list, and history remain operable.                                                                        |
| J30 | Script instead of Apply.                                     | Exact supported script generated; no job created or executed.                                                                           |
| J31 | Invoke the dedicated Agent command or server context action. | Opens a standalone Agent jobs panel directly, including readiness/setup when needed, without navigating SQL Diagnostics or Query Store. |

## 15. Verification and remaining decisions

Package tests cover identity, units/date decoding, routing validation, schedule interpretation, grouping/capped history, SQL/return-code compilation, and evidence rules. Extension tests cover target selection, drafts, capability/action gating, review, asynchronous outcomes, conflicts, and stale response rejection. Real-server tests must verify transaction and scheduler behavior; generated-SQL string assertions alone are insufficient.

Use representative fixtures for failures, retries, handled errors, disabled/shared/multiple schedules, never observed history, long durations, restarts, limited permissions, and non-T-SQL definitions. Render/inspect the jobs list, create wizard, schedule preview, history tree, and all readiness/action states.

Outstanding decisions beyond the questions asked: enabled-on-creation default; notification/output editing depth; supported recurrence/platform matrix; local draft restoration; history retention-management scope; definition export format; and exact role/subsystem support per target. Do not inherit Query Store mutation scope as blanket authorization for Agent actions.
