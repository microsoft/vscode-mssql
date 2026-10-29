# Refactor extraction after Query Studio core

Updated October 29, 2026.

## Integration baseline

Query Studio core and basic pinned results merged in #23131. The full refactor is
reconciled with main at `b44159268` on `dev/karlb/refactor_sync`, continuing from
the previous integration baseline `74b5379c6`. This is an integration branch,
not a proposed PR containing every remaining feature.

Main's accepted implementations remain authoritative: `.mssql` editor selection,
preview gates, Save As and hot-exit handling, clipboard/export leases, definition
delivery, shared grid behavior, localization, and build/lint improvements. The
unreleased vector, spatial, result-analysis, replay, Docker, and schema visualizer
implementations remain in the integration tree.

The September `refactor_merge.md` in the adjacent `work2` workspace supersedes the
August `vscode-mssql-dev-query-split-plan.md`. Continue its direct-to-main workflow:

1. Start each extraction from current main in an isolated worktree.
2. Port the feature's implementation, tests, settings, and documentation together.
3. Reconcile shared files against main instead of copying them wholesale.
4. Verify the disabled path and the packaged extension as well as feature tests.
5. After acceptance, merge main into the full refactor and use that baseline for
   the next extraction. Do not rebase the historical refactor commit series.

## Candidate next PRs

These are proposed boundaries, not a commitment to ship all remaining code.

| Candidate                 | Coherent first slice                                                                                                                                                          | Separate follow-ups and extraction gates                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Query result analysis     | Bounded transforms and derived snapshots over the existing retained-result service; `mssql_query_results` access with per-invocation consent for values; pin derived results. | Keep the `@query` participant/report UX separate if it makes review too broad. Preserve snapshot leases, partial-scan disclosure, cancellation, privacy, and feature-off behavior of the existing query tool. Basic pinning is already in main.                                                                                                                                            |
| Tedious backend           | The `ts-native` SQL Data Plane implementation, exact pinned driver, lazy provider bundle, registry integration, explicit selection, capability handling, and STS fallback.    | This is a query/connection backend, not a language service. The engine and tests are retained, but the current factory list registers only STS2 and fake: restore composition through the accepted registry API. Prove query/page/cancel/reconnect, data fidelity, bounded large values, authentication, packaged loading, and extension-host responsiveness before changing any defaults. |
| Spatial results           | Geometry/geography result inspection in a lazy map pane, including pinned-result parity, worker decoding, and explicit unsupported/partial states.                            | Keep online basemaps, credentials, consent, tile caching, and onboarding in a follow-up if possible. Verify wire capability negotiation and preserve unopened-pane cost.                                                                                                                                                                                                                   |
| Vector analysis           | Read-only Profile, Compare, and Projection over an existing result, with pinned-result parity and bounded worker computation.                                                 | Search, Index, and Pipeline are larger database-backed workflows; split them from local analysis. They need server-version/capability checks, auxiliary-session lifecycle tests, and explicit handling of external model calls.                                                                                                                                                            |
| Query replay              | Query-run capture/replay and its diagnostic UI, using the accepted diagnostics/capture infrastructure.                                                                        | Validate read-only replay safeguards, capture consent/redaction, cancellation, saved-artifact compatibility, and run ownership. Keep central upload/storage separate.                                                                                                                                                                                                                      |
| OE v2 container lifecycle | Deployment handoff, preflight, start/stop/delete, and profile synchronization.                                                                                                | Keep container-destructive confirmations and classic OE behavior intact. This can proceed independently of result features, but it touches shared Docker adapters.                                                                                                                                                                                                                         |

Recommendation: extract bounded result analysis next, since main now contains its
storage/pinning prerequisites. Tedious is the strongest independent alternative
if the next priority is the SQL backend. Do not combine those two features in one
PR. Follow local result analysis with chat/report UX, then choose spatial or the
read-only vector slice based on the next testing priority.

The native SQL language and scripting implementations under `src/sqlLanguage` and
`src/sqlScripting` already match main at this baseline. Further native language
rollout should be treated as a separate integration/defaults decision, rather
than another large source extraction.

Schema visualizer/designer changes remain out of the proposed main-bound work.
They are retained only to keep the complete refactor available for later work.

## Original design sources

The adjacent `work2/notes/vscode-ext-refactor` directory retains the detailed
plans and progress journals. In particular:

- `chat-to-data/PROGRESS.md` and `chat_to_data_execution_plan.md`: retained results,
  transforms, grants, result tools, and the query participant.
- `alt-endpoints/typescript_query_endpoint.md` and its production engineering
  addendum: Tedious backend semantics and fidelity/packaging/performance gates.
- `query-result-tabs/`: vector workbench and spatial pane specifications,
  implementation plans, and readiness reviews.
- `ssms-query-docs/` and `observability-docs/`: query execution, capture, and replay.
- `oe-docs/DOCKER_CONTAINERS_OE_V2_DESIGN.md`: container lifecycle parity.

Historical green test counts in those journals describe the old implementation;
each extraction still needs fresh verification against its current main base.

## Reconciliation validation

- Full MSSQL development build, including extension, webviews, optional workers,
  and notebook renderer; extension and webview typechecks passed.
- Full MSSQL/toolkit lint passed with a 2 GB Node heap. Repository automation:
  14 tests passed.
- All 17 Query Studio Playwright regressions passed against a live SQL Server,
  including preview-off behavior, saves, plans, pinned results, preferences, and
  clipboard selections.
- The hosted unit suite finished with 7,081 passed, 10 skipped, and 17 failures.
  All failures are pre-existing Windows path/case fixtures in Recent SQL Files
  and Overview; those tests and their implementations match main. No remaining
  failures came from the reconciliation.
- The performance harness builds and its 348 local tests passed. The 15
  central-store integration tests remain unverified because their dedicated
  endpoint was unavailable. This check does not establish a new performance
  benchmark baseline.

Reconciliation also restored bundle-only capture session discovery with main's
path containment checks, preserved completion trace metadata through strict
imports, retained main's SQL-text redaction, and aligned the deferred result tool
with main's explicit-reference routing convention.
