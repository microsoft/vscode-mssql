# Language Service Audit Remediation Plan

## Goal

Make the preview T-SQL language service correct, maintainable, observable, and ready for broader production evaluation without regressing parser, feature, metadata, or incremental performance.

This plan consolidates the audits of commit `e6a95b967cdedfca564a16ab484b8830484936de`.

## Working rules

- Add a failing regression test before fixing every confirmed correctness defect.
- Preserve incremental-versus-fresh equivalence checks.
- Do not replace tree-based understanding with new SQL-parsing regexes.
- Centralize and document grammar-sensitive regexes that remain, with focused positive, negative, malformed-input, Unicode, and boundary tests.
- Measure correctness and performance independently.
- Preserve user work and leave `vscode-mssql-dev-query/` untouched.
- Do not claim production readiness until all release blockers and their acceptance criteria are complete.

## Phase 1: Correctness blockers

- [x] Fix SQLCMD incremental coloring so projected-coordinate and source-coordinate token baselines are never mixed.
- [x] Return full mapped color results for non-identity projections until safe incremental deltas are available.
- [x] Remove the `toProjected(...) ?? offset` fallback and return neutral feature results for unmapped directive/include text.
- [x] Test completion, hover, signatures, definitions, references, rename, selection, folding, and coloring inside and around every supported SQLCMD directive.
- [x] Make metadata refresh transactional or generation-scoped.
- [x] Pass cancellation through refresh work and prevent mapping/publication after failure, cancellation, or generation replacement.
- [x] Preserve the last successful metadata snapshot after a failed refresh.
- [x] Fix UTF-16 corruption in metadata invalidation around astral Unicode characters.
- [x] Replace cross-statement metadata-invalidation regex classification with parsed statement/batch classification.
- [x] Cover `GO`, multiple statements, incomplete SQL, nested comments, escaped literals, Unicode, and bracketed temporary tables.

### Phase 1 acceptance criteria

- Full and incremental SQLCMD color results are equivalent after mapping.
- No request in removed or included source text can return a result for unrelated SQL.
- Deferred concurrency tests prove that late metadata work cannot publish after failure or cancellation.
- Metadata invalidation preserves exact UTF-16 offsets and cannot cross statement or batch boundaries.

## Phase 2: Source-mapping integration

- [x] Create one coordinate-mapping policy for source-to-projected points, projected-to-source ranges, unmapped positions, token coalescing, and result identity.
- [x] Use that policy from both feature and coloring wrappers.
- [x] Wire source-mapped services into the extension and worker execution routes.
- [x] Keep projected and source result identities/baselines separate.
- [x] Replace duplicated SQLCMD directive inventories with one descriptor table that generates scanning, completion, documentation, and exhaustive tests.
- [x] Add end-to-end preview tests in addition to isolated wrapper tests.

### Phase 2 acceptance criteria

- No feature returns a range, edit, or token in the wrong file or coordinate space.
- Extension, worker, and direct package routes produce equivalent mapped results.

## Phase 3: Identifier and catalog-name ownership

- [x] Replace competing identifier regexes and scanners with one role-aware identifier module.
- [x] Support complete and incomplete multipart names, bracket/quote state, Unicode, escapes, leading dots, empty components, temporary names, variables, and cursor prefixes.
- [x] Centralize identifier writing and quote reserved words and otherwise unsafe names automatically.
- [x] Separate display spelling, ordinal keys, and metadata/collation comparison policy.
- [x] Remove locale-dependent casing from identifiers, catalog keys, sort keys, and discriminators.
- [x] Add a hostile-identifier matrix across completion, binding, diagnostics, hover, definition, references, rename, signatures, and formatting contracts.
- [x] Add an architecture check prohibiting new ad hoc identifier grammars outside the central module.

### Phase 3 acceptance criteria

- Names such as `[My Schema].[Order-Items]`, `[select]`, escaped delimiters, Unicode names, `$`, `#`, and `@` behave consistently across every feature.
- Node and browser-worker runtimes produce identical comparison keys under different host locales.

## Phase 4: Remove secondary SQL parsers from feature code

- [x] Replace raw-text clause detection such as catalog completion context with syntax-tree and cursor-context queries.
- [ ] Retain regexes only for genuinely lexical questions or measured recovery cases.
- [ ] Move remaining grammar-sensitive regexes into owned, named modules with rationale and tests.
- [ ] Split semantic diagnostics by diagnostic family instead of concentrating unrelated recognizers in one file.

### Phase 4 acceptance criteria

- Completion and diagnostics derive structural context from the published parse snapshot during valid and normally incomplete typing states.
- Every remaining grammar-sensitive regex has explicit ownership, documentation, and direct tests.

## Phase 5: Shared semantic snapshot

- [x] Ensure parsing, binding, completion, coloring, hover, signatures, definitions, references, and diagnostics consume one published document snapshot.
- [x] Prevent the first lazy feature request from unexpectedly rebuilding the entire semantic model.
- [x] Preserve narrowed incremental semantic results when publishing updated snapshots.
- [x] Replace linear scope, name, call, and availability lookups with range indexes.
- [x] Store the pinned metadata generation and completeness state on the bound snapshot.
- [x] Publish statistics from that same immutable snapshot instead of pinning metadata again.

### Phase 5 acceptance criteria

- Feature requests do not reparse or rebind when their required snapshot data is already present.
- First-hit and warm feature costs are separately measured and bounded.
- Reported metadata generation always matches the generation used for binding.

## Phase 6: Metadata safety, sharing, and policy

- [x] Share catalog sessions by connection, database, and profile instead of loading a catalog per document.
- [x] Retain immutable pinned metadata generations for active document snapshots.
- [x] Add explicit boundary decoders for object categories, principal kinds, flags, and SQL integer IDs.
- [x] Consolidate object type codes, column/parameter capabilities, and SQL query filters into one descriptor registry.
- [x] Generate `NOLOCK` query variants intentionally instead of removing hints with string replacement.
- [x] Make page sizes, result limits, cache sizes, default schema, and latency budgets documented runtime options.
- [x] Emit observable truncation and data-quality events for unknown values and limits.

### Phase 6 acceptance criteria

- Concurrent documents reuse metadata without mutable cross-document state.
- Unknown backend values cannot enter validated TypeScript unions through casts.
- Refresh, cancellation, and failure preserve coherent catalog generations.

## Phase 7: Parser-profile type safety

- [x] Define an explicit profile-aware syntax-service interface.
- [x] Remove structural casts used to infer profile support.
- [x] Reject profile changes or reconstruct the syntax service when it cannot apply a new profile.
- [x] Invalidate dependent snapshots after compatibility-level or engine-flavor changes.

### Phase 7 acceptance criteria

- Reported capabilities and the parser profile actually used can never diverge.

## Phase 8: Production-code structure

- [ ] Split the language feature service into completion, navigation, rename/references, signatures, coloring, and shared context modules behind a thin facade.
- [ ] Split the preview host into runtime coordination, metadata refresh, invalidation, VS Code adapters, and status/telemetry modules.
- [ ] Split semantic diagnostics into cohesive diagnostic-family modules.
- [ ] Consolidate tree traversal, node lookup, source extraction, range keys, identifier ranges, built-in registries, XML members, and system-schema policy.
- [ ] Generate or expose a typed syntax-kind union instead of pervasive string comparisons.
- [ ] Review dependency cycles and remove accidental ownership inversions.
- [ ] Remove genuinely unused exports, scaffolding, and orphaned harnesses.
- [ ] Retain and integrate currently unused source-mapping components rather than deleting required architecture.
- [ ] Either implement formatting behind its public contract or accurately mark/remove the unsupported surface.

### Phase 8 acceptance criteria

- Every production feature has a clear owner and can be tested without constructing the entire extension host.
- Large files are split along behavior boundaries without duplicating state or parsing.

## Phase 9: Test infrastructure

- [ ] Make grammar generation a hermetic prerequisite for every applicable build and test lane, or commit generated output with a no-diff regeneration check.
- [ ] Prevent individual tests and watch mode from consuming stale generated parser output.
- [ ] Rename `test:all` or make it genuinely include integration tests.
- [ ] Restore normal test isolation and opt out only for explicitly documented suites.
- [ ] Add a deferred-promise metadata concurrency harness.
- [ ] Add compile-only TypeScript public API contract tests for metadata, source maps, profiles, deltas, Node, and browser workers.
- [ ] Clearly separate corpus non-regression baselines from correctness/conformance gates.
- [ ] Add clean-checkout, shuffled-order, SQLCMD, hostile-identifier, browser-worker, cancellation, and large-catalog CI lanes.

### Phase 9 acceptance criteria

- Every documented test command is reproducible from a clean checkout.
- No lane can silently use stale grammar output or hidden shared test state.
- “All tests” has an exact, truthful meaning.

## Phase 10: Performance and memory gates

- [ ] Measure the first completion, hover, diagnostic, definition, signature, and coloring request after open, edit, metadata refresh, and rebind.
- [ ] Measure warm feature requests separately.
- [ ] Measure shared-catalog versus per-document catalog memory.
- [ ] Include metadata refresh, worker transfer, source mapping, and extension heartbeat costs.
- [ ] Use explicit warmups, repeated samples, p50, p95, dispersion, randomized/interleaved lanes, and machine-readable JSON.
- [ ] Keep incremental-versus-fresh correctness validation outside timed regions.
- [ ] Cover one large batch, many batches, malformed SQL, Unicode, and anonymized realistic scripts in addition to generated batch-heavy corpora.

### Phase 10 acceptance criteria

- Performance cannot appear improved because expensive lazy work was omitted or a best-of sample was selected.
- Benchmark results include exact commit and machine/runtime information and remain comparable over time.

## Phase 11: Observability and privacy

- [x] Remove identifiers and SQL fragments from exported server-error messages.
- [x] Distinguish `zero`, `unavailable`, and `not collected` in exported statistics.
- [x] Report the metadata generation used by the bound snapshot.
- [x] Test exported statistics against server errors containing object names and SQL text.

### Phase 11 acceptance criteria

- “Stats for nerds” exports contain no SQL text or catalog identifiers and accurately describe the analyzed snapshot.

## Phase 12: Documentation consolidation

- [ ] Add a capability matrix using `Implemented`, `Partial`, `Experimental`, and `Planned` states.
- [ ] Separate the consumer README, architecture/ADRs, current readiness report, active backlog, and historical reports.
- [ ] Mark old readiness reports as superseded with commit, date, scope, commands, environment, and unresolved blockers.
- [ ] Archive or replace the append-only progress ledger.
- [ ] Remove user-specific paths, agent commentary, obsolete benchmark claims, and inappropriate private-source references from public documentation.
- [ ] Correct claims about workers, formatting, source mapping, typed syntax nodes, redaction, test coverage, and benchmark lanes.

### Phase 12 acceptance criteria

- A reader can determine current capability and production readiness without interpreting historical ledgers or contradictory documents.

## Definition of done

- [ ] All Phase 1 correctness blockers are closed with regression tests.
- [ ] Source-mapped extension and worker routes pass full-versus-incremental equivalence tests.
- [ ] Metadata refresh passes deterministic failure, cancellation, late-completion, and previous-snapshot preservation tests.
- [ ] Identifier behavior is centralized and the hostile-identifier matrix passes across language features.
- [ ] Features reuse one parse/semantic snapshot without unnecessary reparse or whole-document rebind.
- [ ] Clean-checkout offline and integration lanes pass with hermetic generated output.
- [ ] Performance and memory gates pass without weakening correctness checks.
- [ ] Exported observability data meets its privacy contract.
- [ ] Documentation accurately describes the tested commit and current capability state.
- [ ] No unresolved production blocker is hidden by a baseline, skipped test, fallback, or stale readiness report.
