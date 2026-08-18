# T-SQL language-service completion runbook

Use this runbook autonomously until the six milestones below meet their acceptance criteria. Work
on correctness before breadth, and keep every editor feature on the existing immutable syntax and
semantic snapshots.

Formatting, references, rename, folding, and selection ranges are deliberately out of scope. Keep
two explicit routing modes: isolated development routes preview-owned features only and never falls
back, so engine testing is unambiguous; release preview routes each out-of-scope feature to its
legacy provider so existing functionality does not disappear. The stats view must identify the
owner of every routed feature. Silent fallback or silent feature loss is a release-blocking bug.

## Read first

Read these files completely before changing the corresponding layer:

1. [`../../README.md`](../../README.md) — package boundaries, snapshots, workers, metadata, and
   performance expectations.
2. [`../../GRAMMAR_PROVENANCE.md`](../../GRAMMAR_PROVENANCE.md) — grammar policy and generation.
3. [`../../src/syntax/lezer/grammar/tsql.grammar`](../../src/syntax/lezer/grammar/tsql.grammar),
   [`../../src/syntax/lezer/lezerSyntaxService.ts`](../../src/syntax/lezer/lezerSyntaxService.ts),
   and [`../../test/corpus/tsql-conformance/README.md`](../../test/corpus/tsql-conformance/README.md)
   for grammar or recovery work.
4. [`../../src/semantics/catalogSemanticBinder.ts`](../../src/semantics/catalogSemanticBinder.ts),
   [`../../src/semantics/tsqlSemanticDiagnostics.ts`](../../src/semantics/tsqlSemanticDiagnostics.ts),
   and [`../../src/metadata/contracts.ts`](../../src/metadata/contracts.ts) for binding work.
5. [`../../src/features/tsqlLanguageFeatureService.ts`](../../src/features/tsqlLanguageFeatureService.ts)
   and [`../../test/features`](../../test/features) for completion, hover, and definitions.
6. [`../../src/coloring`](../../src/coloring) and
   [`../../../../extensions/mssql/src/languageservice/preview/previewLanguageService.ts`](../../../../extensions/mssql/src/languageservice/preview/previewLanguageService.ts)
   for coloring and extension routing.

Read the nearest focused test before adding behavior. When metadata changes, inspect every provider
and adapter under `src/metadata` and `src/adapters`, then run their shared contract suite.

## Rules agents must not violate

- A batch is one reproduction-driven change: a single user-visible failure (or one context/matrix
  slice of a milestone checkbox), its focused test, and the smallest implementation that fixes it.
  Milestone checkboxes are far larger than batches; a checkbox is done when its batches are.
- Milestone scope, exit criteria, and checklist wording are immutable during implementation. An
  agent must record partial progress and limitations in the progress ledger; it must not narrow an
  inventory, redefine "done," edit an acceptance criterion, or check a milestone box to match the
  work it happened to finish. Only the user or a designated integrator may check a milestone box
  after independently reviewing its evidence.
- Claim one unchecked batch and its source/test paths in the progress ledger before editing. Agents
  may run concurrently only on non-overlapping paths. Only one agent at a time may edit
  `tsql.grammar`, generated-parser inputs, `tsqlLanguageFeatureService.ts`, metadata contracts, shared
  feature contracts, or the preview extension integration.
- Preserve lossless text, trivia, UTF-16 offsets, `GO` boundaries, and immutable prior snapshots.
- Use CST nodes and bound symbols. Do not add regex recovery for structure the grammar can represent.
- A feature request must consume the current runtime snapshot; completion, coloring, hover, and
  definition must not parse independently.
- Never resolve missing catalog data synchronously. Request the smallest lazy metadata section,
  return an honest incomplete/empty result, and let metadata publication trigger rebinding.
- Incomplete metadata means unknown, not absent. Damaged SQL must not create phantom declarations,
  references, definitions, or semantic diagnostics.
- Do not weaken tests, raise corpus ceilings, hide diagnostics, or add permissive grammar catch-alls
  to make a batch pass.
- Replacing exact grammar choices with `IdentifierName`, `Expression`, an opaque node, or another
  permissive production is incomplete unless the same batch adds the required allowlist/shape
  validation and negative-neighbor tests. A valid example passing is insufficient: nearby invalid
  spellings and combinations must still produce the intended diagnostic.
- Do not commit, push, reset, clean, or touch unrelated worktree changes unless explicitly asked.
- Do not run grammar generation and TypeScript compilation concurrently.
- Grammar generation is long-running and machine-dependent. The current measured local baseline is
  about 218 seconds with the configured heap; record a same-machine baseline before assessing a
  change. Batch related grammar edits, never regenerate per tweak, and skip generation when grammar
  inputs are unchanged. Do not infer a regression from cross-machine generation time.
- Keyword demotion trap: the runtime keyword specializer
  ([`keywordSpecializer.ts`](../../src/syntax/lezer/keywordSpecializer.ts)) applies the reserved list
  from [`keywords.generated.ts`](../../src/syntax/keywords.generated.ts) as a specialization with no
  identifier fallback. A token that stays in the grammar and is on that reserved list (for example
  `STATISTICS`, `USER`, `TABLE`) can never parse as `IdentifierName`, so rules touching such tokens
  need explicit branches. Keywords removed from the grammar entirely are safe — their term vanishes
  and the reserved lookup skips them.
- State-explosion trap (worse than a conflict, because there is no error): an ambiguous rule does
  not always produce a `GenError`. A rule such as
  `Kill IdentifierName IdentifierName? ... | Kill IdentifierName` — where an optional element makes
  two alternatives overlap on unbounded input — can instead send the generator into a state blow-up.
  The symptom is a build that never finishes: memory climbs past its usual peak (about 4 GB here)
  and CPU drops to a few percent as the process thrashes, so it looks like a slow build rather than
  a broken grammar. If a regeneration passes roughly double its normal wall-clock, check the
  process: sustained high memory with low CPU means abandon and fix the rule, not wait. Prefer
  alternatives with fixed word counts over an optional element that lets two branches overlap.
- Trailing-optional trap: a statement rule that ends in an optional whose first token can also
  start a statement (`ENABLE`, `DISABLE`, `WITH`, and most contextual keywords) produces a
  shift/reduce conflict against the statement sequence, because the parser cannot tell whether the
  token continues this statement or begins the next one. `(From File Equal StringLiteral)?` is safe
  in the same position because `FROM` cannot start a statement. Use the existing
  `optionalDdlTail<Content>` template for those tails instead of a plain `?`; it is the grammar's
  established idiom and resolves the choice as a bounded GLR fork. This conflict is cheap to hit and
  cheap to detect — the generator reports it within about two minutes — but each occurrence still
  costs a regeneration, so prefer the template from the start.
  The right remedy depends on where the optional sits. For a statement-level tail use
  `optionalDdlTail<Content>`. Inside an already-GLR-marked region such as `namedTableSourceTail`,
  repeat that region's own marker (`~sourceSuffix`) after the new optional instead; wrapping a
  clause there in `optionalDdlTail` mixes two ambiguity schemes over the same span. Inserting any
  new optional into such a region re-opens the ambiguity the marker was placed to resolve, so the
  marker has to be repeated after the insertion, not only before it.
- New-token trap (the same mechanism in the other direction): adding a token to the grammar's
  `@external extend` list does **not** make the parser produce it. The specializer only emits a
  contextual term whose lowercase spelling appears in `contextualKeywordNames` (generated from
  SqlParser's `ContextKeywords.txt`) or in the hand-maintained `parserLocalContextWords` set in
  `keywordSpecializer.ts`. A word in neither list lexes as a plain identifier, so a rule referencing
  that token silently never matches and the construct still recovers — the symptom is a syntax error
  on the very keyword the new rule was written for. Before paying a regeneration, confirm with
  `grep -oiw <word> src/syntax/keywords.generated.ts src/syntax/lezer/keywordSpecializer.ts`.

## Establish a local baseline

Before the first batch on a machine, append the branch, commit, worktree state, Node version, test
count, corpus report, and benchmark output to the progress ledger. From this package run:

```powershell
npm run build:typescript
npm run build:workers
node scripts/run-tests.mjs all
node scripts/report-tsql-corpus.mjs
node --expose-gc benchmarks/semantic-diagnostics.mjs --statements 100 --warmups 10 --samples 40
node --expose-gc benchmarks/run.mjs --sizes 100k,1m
node --expose-gc benchmarks/catalog-features.mjs
```

Use only same-machine, same-command measurements for regression claims. Otherwise record numbers
without comparison.

## Work loop

For each batch:

1. Mark it `[~]`, record the owner, and write the exact user-visible failure being addressed.
2. Add a failing focused test before implementation. Include the valid form, incomplete/malformed
   form, exact ranges or edits, and fresh/incremental equivalence where state can matter.
3. Implement at the lowest correct layer: grammar for structure, binder for identity/scope/type,
   metadata for persisted facts, and feature service for presentation.
4. Run the focused test and TypeScript build. Generate grammar only if grammar inputs changed:

    ```powershell
    node --max-old-space-size=8192 scripts/build-grammar.mjs
    npm run build:typescript
    node --test --test-isolation=none test/<focused-test>.test.js
    ```

5. Run `node scripts/run-tests.mjs fast` for every batch and
   `node scripts/run-tests.mjs corpus` for grammar, recovery, or binder changes. Run
   `npm run test:integration` for metadata or extension-facing behavior when the configured server
   is available.
6. Run the directly affected benchmark. Investigate a repeatable same-machine median regression
   above 10% before continuing.
7. Mark the batch `[x]` only after all acceptance criteria pass. Record files, tests, corpus delta,
   benchmark before/after, and any remaining limitation in the progress ledger.

## Milestone 1 — zero false recovery on valid T-SQL

- [ ] Inventory every diagnostic from the real-world fixtures and every recovery-bearing corpus
      file. Classify each fixture as valid/supported, valid but profile-gated, intentionally malformed,
      or a negative diagnostic fixture; group findings by grammar family and language domain. The
      inventory must explicitly cover query, DML, DDL, programmable-object, JSON/XML/vector, security,
      and administrative SQL. A self-selected list of a few examples is not a completed inventory.
- [ ] Remove every raw recovery node from every valid T-SQL fixture, including valid syntax that is
      rejected only by a compatibility-level or engine-flavor gate. Profile-gated syntax must still
      parse structurally and receive the deliberate feature diagnostic. No valid-SQL recovery finding
      may be deferred because it is rare or inconvenient.
- [ ] Convert every fixed reproduction into a discoverable positive, negative-neighbor,
      malformed/incomplete, and incremental-equivalence regression where applicable.

Status: **in progress**. Completed batches below are evidence of progress only; they do not close
the milestone or any checklist item by themselves.

Completed batches so far (see the ledger for exact tests and before/after measurements):

- Parenthesized query-expression grouping after a set operator (`SELECT 1 UNION (SELECT 2)`,
  `EXCEPT`/`INTERSECT` grouping, `WITH c AS ((SELECT 1))`, extra derived-table wraps).
- `SET DEADLOCK_PRIORITY -5` (signed integer values).
- Selected `SET` statement structures: correct single-toggle on/off lists (`SET NOCOUNT, ANSI_NULLS
ON`, not one toggle per name), cross-name generic option comma-joining (`SET LANGUAGE
us_english, DATEFORMAT ymd`), `SET STATISTICS` comma-lists, `SET ERRLVL`, and a precise
  "integer value X is out of range" diagnostic (instead of generic recovery) for a decimal
  `TEXTSIZE`/`ERRLVL`/`ROWCOUNT` value. This batch is not complete as the full `SET` family until
  recognized option/value validation and its negative tests exist.

Still open, in order of what's known about them:

- Statement-leading `(SELECT 1) UNION SELECT 2` (a full statement starting with `(`) is still
  recovery. Investigated: widening the shared `SelectStatement` node itself is unsafe because it
  is reused at `Return (SelectStatement | ReturnedQuery)` (direct collision — `ReturnedQuery`
  itself starts with `OpenParen`) and at CREATE TABLE's `As? SelectStatement` alternative (collides
  with `TableDefinition`'s leading-paren column list, a very common shape). A safe fix needs a new
  node used only in the top-level `Statement` alternation; no other `Statement` alternative starts
  with a bare `(`, so that path should be conflict-free, but has not been attempted or verified.
- Generic `SET` productions currently accept unknown names such as `SET BANANA POTATO` and
  `SET BANANA ON` without a diagnostic. Add explicit recognized-name/value-family validation and
  exact negative tests before claiming the `SET` work complete. Correctly model and test
  `FIPS_FLAGGER` and `CONTEXT_INFO` rather than relying on the generic production to accept them.
- Found but out of scope for a `SET`-local batch: `Off` is fully reserved in the authoritative
  source (`Parser/Keywords/keywords.txt` lists `off _OFF 42`, identically to `on _ON 42`) but is
  modeled as `extend` (non-reserved, dual identifier/keyword) in this grammar's `@external extend`
  list. This project's own reserved/contextual split is generated from those same keyword files via
  `scripts/import-sqlparser-keywords.mjs`, so this is a real mismatch worth an independent,
  corpus-verified audit — not something to fold into whatever batch happens to touch `SET` next,
  since reserving `Off` could affect any place `off` is currently accepted as a bare identifier.
- Cosmetic only: `Low`, `Normal`, `High` show as unused-rule warnings in `@external extend` (their
  only reference, inside `DeadlockPriority`'s old enumeration, was replaced by generic
  `IdentifierName` matching). Harmless — fold their removal into whichever future batch next
  rebuilds the grammar for an unrelated reason.

Acceptance criteria:

- The ledger contains a stable, reviewable classification of every corpus and real-world fixture,
  with every recovery-bearing file assigned to a grammar family and one of the four fixture classes
  above.
- Every valid/supported and valid/profile-gated fixture has exactly zero raw recovery nodes. There
  are no deferred valid-SQL recovery findings, regardless of frequency.
- Intentionally malformed and negative fixtures have an explicit reviewed expectation. Their
  recovery is bounded to the damaged construct, produces the intended diagnostic, and does not
  alter subsequent statements or `GO` batches. Removing their recovery nodes is not the goal.
- Valid targeted SQL produces no syntax or phantom semantic diagnostic.
- Each widened production has invalid-neighbor tests proving that unknown names, invalid option
  combinations, and unsupported value shapes do not become silently valid. In particular,
  `SET BANANA POTATO` and `SET BANANA ON` must not parse as recognized `SET` statements without an
  appropriate diagnostic.
- The statement after the damaged construct, and every subsequent `GO` batch, parse the same as they
  would without the damage.
- No fixture gains an unreviewed recovery node. The report publishes separate counts for valid,
  profile-gated, intentionally malformed, and negative fixtures rather than hiding expected errors
  in one aggregate ceiling.
- Fresh and incremental syntax diagnostics are identical for the same final text.
- Keyword specialization changes have focused token, completion-context, and diagnostic tests so a
  grammar fix cannot silently degrade coloring or completion.
- Only the user or designated integrator checks the milestone boxes after reviewing the inventory,
  tests, corpus report, and same-machine benchmark evidence. An implementing agent reports batches;
  it does not declare the milestone complete.

## Milestone 2 — normal incomplete-input recovery

- [ ] Add progressive typing matrices for multipart names (`dbo.`), delimited names (`[]`, `""`),
      lists, calls, `INSERT (...)`, joins, CTEs, DDL headers, and procedure/function bodies.
- [ ] Keep completion available at each useful damaged cursor position.
- [ ] Prevent incomplete statements from exporting phantom symbols or diagnostics.

Acceptance criteria:

- Every matrix checks each keystroke state, not only the finished statement.
- Recovery is bounded to the damaged construct and preserves subsequent statements/batches.
- Semantic diagnostics are emitted only when their required facts remain known.
- Full and incremental trees, diagnostics, and exported semantic identities agree.

## Milestone 3 — binding and completion coverage

- [ ] Complete local scopes: aliases, correlated queries, CTEs, derived sources, temporary tables,
      table variables, routine parameters, and projected columns.
- [ ] Complete catalog contexts: databases, schemas, objects, columns, routines, types, principals,
      DDL options, and administrative statements.
- [ ] Preserve cross-schema/cross-database edits, user-before-system ranking, `SELECT *` expansion,
      and smart `INSERT` expansion in complete and incomplete syntax.

Acceptance criteria:

- A context-matrix suite covers empty, prefix, qualified, quoted, incomplete, and metadata-loading
  states for each supported context.
- Completion edits produce executable qualified SQL and never duplicate delimiters or brackets.
- Results are stable and deduplicated; capped results set `incomplete` so narrowing can continue.
- Completion performs no parse and no broad synchronous metadata refresh.
- The 60k-object catalog guard passes and same-machine completion p50 does not regress over 10%.

## Milestone 4 — semantic coloring

- [ ] Replace `ScaffoldColorizationService` with lexical and semantic classification.
- [ ] Register full, range, and delta semantic-token providers in preview mode
      (`provideDocumentSemanticTokens`, `provideDocumentRangeSemanticTokens`, and
      `provideDocumentSemanticTokensEdits`).
- [ ] Classify lexical tokens plus server, database, schema, object, column, routine, parameter,
      variable, type, alias, CTE, temporary, declaration, write, system, quoted, and readonly roles.

Acceptance criteria:

- Tokens are UTF-16-correct, sorted, non-overlapping, deterministic, and use the published legend.
- Comments, strings, quoted identifiers, and malformed tokens cannot be recolored as symbols.
- Full/range/delta results represent the same final classifications after edits.
- Coloring reuses syntax/semantic snapshots and performs zero parses and metadata queries.
- Extension-level tests prove preview routing returns the new tokens and suppresses stale results.

## Milestone 5 — hover

- [ ] Cover local and catalog objects, columns, variables, parameters, aliases, routines, and types.
- [ ] Add built-in documentation/signatures and useful expression/result-column type inference.
- [ ] Show qualified name, kind, SQL type, nullability, and signature only when known.

Acceptance criteria:

- Exact ranges work for multipart, bracketed, and quoted identifiers.
- Loading, failed, stale, and permission-limited metadata never produces invented details.
- Hover requests only targeted lazy metadata and succeeds on the published snapshot without parsing.
- Focused tests cover local/catalog, expression, built-in, incomplete input, and metadata transitions.
- Extension-level tests verify the preview provider and stale-version cancellation.

## Milestone 6 — catalog definitions

- [ ] Add a host-neutral `ObjectDefinitionProvider` and definition descriptor contract without VS
      Code dependencies. Keep object scripting separate from catalog `MetadataProvider` sections.
- [ ] Add null and in-memory definition providers for offline behavior and contract tests.
- [ ] Connect the preview extension's definition provider to the existing scripting service and
      generated virtual documents; do not add scripting responsibility to the simple-query catalog
      adapter.
- [ ] Support cross-database tables, views, procedures, functions, types, and other scriptable objects.
- [ ] Cache by connection, database, object identity, and metadata generation; invalidate after relevant
      execution and metadata refresh.

Acceptance criteria:

- Existing same-document definitions remain correct for locals, CTEs, aliases, and columns.
- Catalog navigation opens the correct generated definition and selects the requested object/member.
- Cancellation, missing permission, dropped objects, stale versions, and reconnects fail safely.
- Definition lookup triggers neither parsing nor a broad catalog refresh.
- Definition-provider contract tests cover null, in-memory, extension scripting, and any dev/query
  definition implementation. Catalog metadata-adapter tests remain separate unless an adapter
  explicitly implements both contracts.
- Live integration and extension tests cover same-database and cross-database navigation.

## Final definition of done

All milestone boxes are checked with ledger evidence; the complete offline and configured integration
suites pass; corpus files have zero regressions; feature calls share one parse/bind snapshot; and
same-machine parser, binder, completion, and metadata benchmarks have no unexplained regression over
10%. Isolated development mode must serve completion, diagnostics, semantic coloring, hover, and
definitions from the new service with no fallback. Release-preview mode must additionally route
formatting, references, rename, folding, and selection ranges to legacy providers so existing
features do not disappear. Extension-level tests and the stats view must prove both routing modes.
Formatting remains a separate future milestone.

## Progress ledger

The ledger lives in
[`LANGUAGE_SERVICE_PROGRESS_LEDGER.md`](LANGUAGE_SERVICE_PROGRESS_LEDGER.md), not in this runbook,
so batch claims and appends never contend with runbook edits. Append entries; do not rewrite prior
measurements. Use these templates:

### Baseline

- Owner:
- Date / branch / commit:
- Worktree and Node version:
- Offline / integration tests:
- Corpus clean files / raw recovery:
- Parser / binder / catalog-feature benchmarks:

### Batch template

- Status: `[~]` in progress / `[x]` complete
- Owner / milestone / scope:
- Reproduction and expected behavior:
- Files and tests:
- Focused / fast / corpus / integration results:
- Benchmark before / after:
- Remaining limitations or next batch:
