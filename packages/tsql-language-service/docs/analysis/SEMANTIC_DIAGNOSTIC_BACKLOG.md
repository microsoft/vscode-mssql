# T-SQL diagnostic backlog

Process every item using
[`DIAGNOSTIC_COMPLETION_RUNBOOK.md`](./DIAGNOSTIC_COMPLETION_RUNBOOK.md). This file is the
authoritative queue and progress ledger; the runbook is the authoritative execution procedure.

This is the review checklist for diagnostic work after `DuplicateTriggerActionType`. The inventory
comes from `test/fixtures/tsql-diagnostic-catalog.cjs`; completion is locked by
`test/semantics/diagnostics/coverage.test.js`. Each item names the implementation seam required to finish
it without heuristics. A family is complete only with exact code/message/range tests, valid and
malformed false-positive guards, incremental/full equivalence where syntax-owned, and no new corpus
or direct-binder benchmark regression.

Current mechanical count: **265 catalog entries, 257 product diagnostics, 257 marked supported, 0
product families remaining**. The eight non-diagnostic entries now carry an explicit `role` in the
catalog fixture and are excluded from the denominator by
`test/semantics/diagnostics/coverage.test.js`.

## Diagnostic evidence requirements

Exact codes, message templates, report ranges, and supported input shapes must be backed by reviewed
T-SQL behavior and checked-in tests, not recollection. Every new family needs an exact-output fixture,
positive and malformed-input guards, and a short explanation of the observable behavior it preserves.
Public documentation must not depend on private source locations or implementation names.

## Completed in the current batch

- [x] `DuplicateTriggerActionType` — syntax validation scans each undamaged DML trigger action list once, reports every repeated `INSERT`/`UPDATE`/`DELETE` token, and covers CREATE, CREATE OR ALTER, ALTER, incremental updates, DDL-event exclusions, and exact ranges.

## Progress record

### 2026-08-16 — inventory correction and final statement-option diagnostics

- Status: complete
- Layer: syntax (bounded EXECUTE recovery and addressable legacy/scoped option nodes), binder
  (statement-specific option validation), coverage inventory
- Evidence: focused final audit suites 35/35; combined offline suite 713/713; live integration 5/5;
  exact code/message/range tests, valid and damaged-input guards, statement isolation, and
  fresh/incremental equivalence. All 56 families added since the preceding checked-in manifest are
  named explicitly by their linked executable suites.
- Coverage: supported 257/257 product diagnostics; product families remaining 0
- Corpus: 0 files regressed; 322/485 parseable fixtures are clean and aggregate raw recovery is
  1,879, improved from the locked 2,364 ceiling.
- Local performance: direct semantic bind p50 is 7.00 ms for 100 local scalar statements, 12.92 ms
  for resolved catalog selects, and 10.95 ms while emitting 100 missing-object diagnostics. Warmed
  full parsing is 140.84 ms / 1,349.63 ms / 13,424.40 ms at 100 KiB / 1 MiB / 10 MiB; bounded
  incremental edits are 5.01–11.68 ms / 10.59–11.88 ms / 12.24–13.69 ms. These are local
  measurements, not cross-machine regression claims.
- Notes: two catalog strings previously counted as diagnostics are actually signature-help text.
  They remain covered by the signature-help suite but now carry an explicit
  `signature-help-text` role and cannot inflate diagnostic coverage. The three real remaining
  families have concrete validators: EXECUTE recognizes only the finite set of known misplaced
  module options, legacy unparenthesized CREATE INDEX options use their historical allowlist, and
  known database-scoped settings validate their distinct value families while unknown settings
  remain forward-compatible.

### 2026-08-16 — CLR members, routine contracts, binding, and external streams

- Status: complete
- Layer: metadata contract (CLR type members, extended procedures), syntax (member access, external
  streams, legacy transaction names), binder (member, routine, and binding validations), features
  (signature help)
- Evidence: focused 17/17 UDT members, 7/7 member-access grammar, 9/9 built-in function names,
  9/9 foreign key candidate keys, 8/8 external stream parameters, 7/7 signature help; full
  `npm run test:all` 699/699; corpus 0 regressed, 61 improved, aggregate 2,364 → 1,892
- Coverage: supported 256/259 product diagnostics; product families remaining 3
- Notes: nineteen families closed in this batch.
  `clrTypeState(ref)` is a new per-object section carrying the declaring CLR class, its assembly,
  whether the type is system-supplied, and its static and instance methods, properties, and fields;
  only a system type's member list is complete enough to prove a member is absent. Member access
  needed real grammar: `Type::Member` and a member reference without an argument list were both
  recovery errors before. `StoredProceduresAlwaysReturnInt` and `ExtendedStoredProceduresNotSupported`
  are not diagnostics at all — they are the return-contract text of parameter help, so they are
  produced by the signature-help provider, with `extendedProcedure` added to routine metadata.
  `NotRecognizedFunctionName` rests on the reviewed built-in scalar catalog, with aggregates and
  window functions excluded because they are separate catalogs; the whole suite, including the
  real-world regression fixtures, produced no false positive. `OperandTypeClash` turned out to be
  guarded only for non-scalar routine parameters rather than by a general conversion matrix.
  `MultiPartIdentifierBindingError` took over the qualified-column case that was previously reported
  as `ColumnPrefixMismatch`, which the engine reserves for a qualified star; both stay reachable.
  One corpus fixture moved from 18 to 19 recovery nodes when member access landed, and the cause was
  modelled rather than rebaselined: SQL Server's legacy `SAVE TRANSACTION <int>:<id>.<id>` name is
  now grammar, which cleared the regression and improved the aggregate again.

### 2026-08-16 — closing measurements for the session

- Coverage: supported 256/259 product diagnostics; product families remaining 3. The session began
  at 201/259 with 58 remaining, so 55 families were closed with executable evidence, across 42
  evidence suites.
- Tests: `npm run test:all` 699/699, which includes the corpus lane. Corpus: 0 files regressed, 61
  improved, aggregate raw recovery nodes 2,364 → 1,892. `node scripts/check-boundaries.mjs` passes,
  so none of the new metadata sections broke a layer boundary.
- Integration: `npm run test:integration` 5/5 against the configured live server, covering
  connection, metadata-backed language features, system catalog binding in representative databases,
  foreign keys against live primary-key metadata, and cross-database schema hydration.
- Benchmarks: semantic binder local scalar p50 7.08 ms p95 11.44 ms; resolved catalog selects
  p50 12.84 ms p95 14.77 ms; missing-object p50 11.16 ms p95 12.15 ms, against the 7.08/11.54/9.98 ms
  p50 baseline recorded at the start of the session. Parser: 100 KiB cold 177.70 ms warm 129.93 ms;
  1 MiB cold 1,283.33 ms warm 1,283.35 ms, against the 1,239.64/1,242.24 ms baseline. This machine
  drifted upward through the session, and the drift was isolated by rebuilding an earlier grammar
  byte-for-byte and remeasuring it, so these are reported as measurements rather than as a
  comparison. The generated parser grew from 389,567 to 407,994 bytes across every grammar addition.
- Follow-up correction: the three families recorded here as blocked were subsequently traced to
  concrete statement rules and completed in the final statement-option batch above. Two
  return-contract strings counted in this historical 256/259 total were also reclassified as
  signature-help text, producing the corrected final denominator of 257 product diagnostics.

### 2026-08-16 — nested DML table sources and the OUTPUT function rule

- Status: complete
- Layer: syntax (nested DML table source), binder (nested rowset shape and OUTPUT functions)
- Evidence: focused 13/13 nested DML and OUTPUT, 6/6 nested DML grammar; full `npm run test:all`
  644/644; corpus regressions 0
- Coverage: supported 238/259 product diagnostics; product families remaining 21
- Performance: the machine drifted during this batch, so the measurements are reported without a
  regression claim. Two runs after the change gave 1 MiB cold 1,627.49 and 1,615.11 ms, warm
  1,324.30 and 1,291.73 ms, against 1,239.64/1,242.24 ms recorded earlier the same session. The
  drift was isolated by rebuilding the previous grammar unchanged — the generated parser was
  byte-for-byte the earlier 401,729 bytes — and remeasuring on the same machine: that unchanged
  parser gave 1 MiB cold 1,447.95 ms and warm 1,392.50 ms, above its own earlier numbers and
  overlapping the post-change pair. The generated parser grew from 401,729 to 405,775 bytes for the
  nested DML rule. Semantic binder lanes over the same period: local scalar p50 7.36 and 7.95 ms,
  resolved catalog selects p50 14.11 and 12.64 ms, missing-object p50 11.40 and 10.85 ms.
- Notes: a DML statement written as a table source is new grammar; it keeps its own statement node,
  requires the alias SQL Server requires, and accepts the terminator a nested MERGE must carry. The
  rowset it exposes is its OUTPUT clause, so a nested statement without one is reported at the
  statement itself. The nested statement also keeps its own scope: its `inserted`/`deleted` rowsets
  are not described by the enclosing query's sources, and the outer query sees only the columns the
  explicit list names. `FunctionNotAllowedInOutput` reuses the tri-state `schemaBound` flag added
  with the indexed-view work, so an unknown binding never becomes a false positive, and a function
  the document itself creates or alters outranks the pinned catalog's description of it.

### 2026-08-16 — security-object and collation metadata and their four families

- Status: complete
- Layer: metadata contract (securable and collation sections), syntax (named `CollateClause`),
  binder (principal security objects and collation names)
- Evidence: focused 14/14 security and collation, 19/19 metadata provider contract;
  full `npm run test:all` 625/625; corpus regressions 0
- Coverage: supported 236/259 product diagnostics; product families remaining 23
- Performance: semantic binder local scalar p50 6.91 ms p95 8.64 ms; resolved catalog selects
  p50 11.71 ms p95 16.02 ms; missing-object p50 9.89 ms p95 12.31 ms, against the 7.08/11.54/9.98 ms
  p50 baseline recorded for this session. Parser after the `CollateClause` change: 100 KiB cold
  188.27 ms warm 125.76 ms, incremental start/middle/end 14.40/10.75/7.35 ms; 1 MiB cold
  1,239.64 ms warm 1,242.24 ms, incremental 10.43/11.12/14.48 ms. The generated parser shrank from
  401,766 to 401,729 bytes, so folding the repeated inline COLLATE tails into one rule added no
  parser state.
- Notes: credentials, certificates, and asymmetric keys are modelled as securables in their own
  section rather than being forced into principal kinds, with `searchSecurables` scoped by database
  so a login searches the server scope and a user searches the current database. The collation
  catalog is a separate section exposed as `collations()`, which returns undefined whenever it is
  unavailable. Both sections default to `unknown` in the in-memory provider: an empty ready list
  would otherwise mean "no collations exist" and turn every COLLATE clause into an error, which a
  pre-existing type-contract test caught. `database_default` always resolves without consulting the
  catalog. `COLLATE` is now one named `CollateClause` node in every position the grammar accepts it,
  so one validator covers column definitions, expressions, rowset schemas, and database statements.

### 2026-08-16 — trigger and constraint metadata and the six trigger catalog families

- Status: complete
- Layer: metadata contract (trigger and constraint sections), binder (trigger catalog)
- Evidence: focused 15/15 trigger catalog, 16/16 metadata provider contract; `npm run test:fast`
  603/603; `npm run test:corpus` 3/3 with zero per-file regressions
- Coverage: supported 232/259 product diagnostics; product families remaining 27
- Performance: no grammar change. Semantic binder local scalar p50 6.97 ms p95 8.11 ms; resolved
  catalog selects p50 12.14 ms p95 16.43 ms; missing-object p50 10.12 ms p95 16.72 ms, against the
  7.08/11.54/9.98 ms p50 baseline recorded for this session; the benchmark corpus contains no
  trigger statement, so the lanes only measure the added dispatch.
- Notes: `triggerState(ref)` and `foreignKeyState(ref)` are new per-object sections, with `triggers`
  and `constraints` added to `MetadataSection` and implemented by the null, in-memory, simple-query,
  and dev/query providers plus the shared contract suite. Trigger identity carries the INSTEAD OF
  flag and the INSERT/UPDATE/DELETE actions; foreign keys carry their update and delete actions;
  `ObjectMetadata.checkOption` is tri-state so only an explicit `true` reports. A trigger lives in
  its own schema, so the object it is attached to is the one carrying the target's name in that
  schema: on CREATE an unqualified trigger name inherits the target's schema, while on ALTER it
  inherits the default schema, which is what makes a mismatch observable. Duplicate activation and
  cascade rules run only for a statement the engine would carry out, and only from loaded trigger
  and constraint sets; the duplicate check skips the trigger being altered so a trigger never
  conflicts with itself.

### 2026-08-16 — index and statistics metadata and the eleven index families

- Status: complete
- Layer: metadata contract (index section), syntax (columnstore ORDER clause), binder (index catalog)
- Evidence: focused 24/24 index catalog, 7/7 ORDER grammar, 13/13 metadata provider contract;
  full `npm run test:all` 590/590; corpus regressions 0
- Coverage: supported 226/259 product diagnostics; product families remaining 33
- Performance: semantic binder local scalar p50 6.87 ms p95 9.60 ms; resolved catalog selects
  p50 11.64 ms p95 14.19 ms; missing-object p50 9.87 ms p95 10.62 ms, against the 7.08/11.54/9.98 ms
  p50 baseline recorded for this session. Parser: 100 KiB cold 172.36 ms warm 125.14 ms, incremental
  start/middle/end 15.11/11.70/7.01 ms; 1 MiB cold 1,226.35 ms warm 1,235.31 ms, incremental
  11.08/14.09/13.90 ms. The generated parser grew from 400,834 to 401,766 bytes for the ORDER rule.
- Notes: `MetadataView.indexState(ref)` is a new per-object section alongside columns and parameters,
  with `indexes` added to `MetadataSection` and implemented by the null, in-memory, simple-query, and
  dev/query providers plus the shared contract suite. Index identity carries kind, uniqueness,
  clustering, statistics, and columns; `ObjectMetadata.schemaBound` is tri-state so only an explicit
  `false` proves a view is not schema bound. The validator follows the engine's own order: the
  nonunique clustered view rule first, then the name/replacement decision, then order columns, then
  the online/offline conflict, then the clustered slot, then the indexed-view rules. A replacement
  removes the replaced index from the object's index set, so replacing the clustered index frees the
  clustered slot while replacing a nonclustered index with a clustered one does not. Nothing is
  reported unless the index set is `loaded`; loading, partial, stale, failed, and failed-with-prior
  all mean unknown, and a target created or dropped in the document is never checked at all. The
  columnstore `ORDER (…)` list is new grammar placed exactly where the engine parses it: after the
  key and INCLUDE lists and before the filter clause.

### 2026-08-16 — build/deployment-mode profile and the fourteen build-mode families

- Status: complete
- Layer: contracts (analysis profile), syntax (CREATE SCHEMA elements), binder (build-mode validation)
- Evidence: focused 21/21 build mode, 5/5 profile contract, 9/9 schema-element grammar;
  `npm run test:fast` 550/550 and `npm run test:corpus` 3/3 with zero per-file regressions. The
  complete `npm run test:all` gate for this batch is the 590/590 run recorded with the index batch
  below, which contains it.
- Coverage: supported 215/259 product diagnostics; product families remaining 44
- Performance: semantic binder local scalar p50 7.08 → 6.64 ms p95 9.93 → 8.79 ms; resolved catalog
  selects p50 11.54 → 11.35 ms p95 12.93 → 12.39 ms; missing-object p50 9.98 → 10.41 ms
  p95 12.71 → 12.00 ms. Parser after the grammar change: 100 KiB cold 171.58 ms warm 122.83 ms,
  incremental start/middle/end 14.39/10.73/6.21 ms; 1 MiB cold 1,245.80 ms warm 1,223.40 ms,
  incremental 10.39/14.47/10.62 ms. Both sides sit inside the run-to-run spread already recorded
  for this branch. The generated parser grew from 389,567 to 400,834 bytes for the new rule.
- Notes: the profile is an explicit immutable `AnalysisProfile` on bind input and on the in-process
  runtime, normalized through one resolver, and folded into the incremental environment version so a
  profile change cannot reuse the other profile's units. A build replays only CREATE data-definition
  statements; every other top-level statement is named by its statement phrase, taken from the fixed
  per-statement-kind table where the parser has a dedicated node and otherwise from the first token
  plus the second when the second is neither an identifier, a variable, nor single-character
  punctuation. Each accepted CREATE statement carries at most one statement-level result and keeps
  the last matching condition, so a DDL trigger outranks ENCRYPTION and a cursor parameter outranks
  ENCRYPTION. Unsupported system types and `EXECUTE AS SELF` are reported independently at the type
  and at the option. CREATE SCHEMA now models its schema elements: the element shift takes priority
  over ending the header, which is the same decision the engine's parser makes, so a CREATE outside
  the element set after an unterminated header is a syntax error rather than a second statement.

### 2026-08-16 — diagnostic completion baseline

- Status: recorded before production changes
- Layer: inventory
- Evidence: `npm run test:all` 520/520; `npm run test:integration` 5/5
- Coverage: supported 201/259 product diagnostics; product families remaining 58
- Performance: semantic binder local scalar p50 7.62 ms p95 10.69 ms; resolved catalog
  selects p50 15.21 ms p95 21.58 ms; missing-object p50 11.73 ms p95 17.88 ms.
  Parser: 100 KiB cold 272.99 ms warm 138.94 ms, incremental start/middle/end
  14.41/11.33/7.80 ms; 1 MiB cold 1,262.20 ms warm 1,234.04 ms, incremental
  11.67/10.62/14.03 ms.
- Notes: branch `aasim/feat/lezer-tsql-language-service` at `e1fd3b2b2`. Pre-existing
  worktree left untouched: modified backlog, untracked runbook, untracked
  `vscode-mssql-dev-query/`. Node v24.15.0. Integration used the configured live
  server. Next item is the build/deployment-mode profile.

### 2026-08-15 — catalog cleanup

- Status: complete
- Layer: inventory
- Evidence: focused 4/4; full 434/434; corpus regressions 0
- Coverage: supported 182/259 product diagnostics; product families remaining 77
- Performance: not applicable, no product code changed
- Notes: the six non-diagnostic entries carry `role: "api-precondition"` or `role: "message-fragment"`
  in the catalog fixture, and three inventory tests pin which names are excluded and why.
  `ParseResultsShouldNotContainNullElement` has no API boundary in this package to unit-test.

### 2026-08-15 — InvalidOptionInCreateProcedure, InvalidOptionInCreateTrigger, InvalidTriggerEventTypes

- Status: complete
- Layer: syntax (grammar + syntax diagnostics) and binder (option classification)
- Evidence: focused 25/25; full 449/449; corpus regressions 0
- Coverage: supported 185/259 product diagnostics; product families remaining 74
- Performance: binder p50 7.88/12.75/11.46 ms, p95 12.13/15.97/12.48 ms across the three lanes, with
  no procedure or trigger `WITH` clause in the benchmark corpus. Parser, two runs per side:
  100 KiB cold 205.0/173.7 → 171.1/209.5 ms, warm 169.4/123.7 → 123.3/181.2 ms;
  1 MiB cold 1245.3/1236.8 → 1434.4/1258.2 ms, warm 1274.9/1226.4 → 1334.1/1266.6 ms.
  The two sides overlap run to run and the generated parser shrank from 389,581 to 389,567 bytes,
  so the widened option rules added no parser state.
- Notes: an option list mixing DML actions with DDL event names, and an unknown option name in an
  EXECUTE `WITH` clause, remain syntax errors rather than being reclassified semantically.

### 2026-08-15 — NameOrAuthorizationKeywordRequired, InvalidOnClause, ReadonlyCannotBeUsed

- Status: complete
- Layer: syntax (grammar + syntax diagnostics) and binder (EXECUTE argument option)
- Evidence: focused 14/14; full 472/480 with only the not-yet-generated cursor batch red; corpus
  regressions 0
- Coverage: counted with the data-type batch below
- Performance: measured once for the shared grammar generation covering both grammar batches
- Notes: `CREATE SCHEMA AUTHORIZATION owner` now parses, which the previous grammar rejected
  outright. The DROP scope tail is a shared `DropTriggerScope` rule so every kind reports the same
  statement-wide range.

### 2026-08-15 — MaximumSizeErrorForAnyType, TypeNameMaxPrefixError, XmlSchemaCollectionMaxPrefixError

- Status: complete
- Layer: binder (data-type specification)
- Evidence: focused 9/9; full 472/480 with only the not-yet-generated cursor batch red; corpus
  regressions 0
- Coverage: supported 191/259 product diagnostics; product families remaining 68
- Performance: no grammar change; binder lanes unchanged because the benchmark corpus declares no
  over-sized or over-prefixed type
- Notes: one existing assertion moved from `MaximumSizeError` to `MaximumSizeErrorForAnyType` for
  `varchar(9001)`. The generic any-type message applies above 8000; the per-type message keeps its
  own range below the ceiling.

### 2026-08-15 — UnrecognizedCursorOption, InvalidUsageOfCursorOption, MixingOldAndNewSyntaxForCursorOptionsNotAllowed

- Status: complete
- Layer: syntax (grammar) and binder (option classification)
- Evidence: focused 8/8; corpus regressions handled with the grammar-conformance work below
- Coverage: counted with the batches below
- Performance: measured with the shared grammar generation
- Notes: `ConflictingCursorOption` now runs on the extended list only, which is where
  `CursorDefinitionInfo` checks it.

### 2026-08-15 — OperatorNotSupported, InvalidGroupByOption

- Status: complete
- Layer: syntax (grammar) and binder (query shape)
- Evidence: focused 6/6
- Notes: `GROUP BY … WITH CUBE`/`WITH ROLLUP` had no grammar at all, so a legacy form present in the
  vendored corpus was a syntax error. The tail attaches to the grouping element it follows because
  the corpus also uses the per-element `WITH (DISTRIBUTED_AGG)` hint mid-list, and a clause-level
  tail collides with it in LR(1).

### 2026-08-15 — PrefixedColumnsNotAllowedInPivot, PrefixedColumnsNotAllowedInUnpivot

- Status: complete
- Layer: syntax (grammar) and binder (pivot columns)
- Evidence: focused 5/5
- Notes: only PIVOT's `IN` list and UNPIVOT's value and pivoted columns parse multipart names.
  UNPIVOT's unpivoted column list stays an unqualified list because prefixes are invalid there.

### 2026-08-15 — InvalidUseOfSideEffectingOperatorWithinFunction, UnrecognizedOption, ComputedColumnsConstraintCheckError

- Status: complete
- Layer: binder
- Evidence: focused 7/7 function body, 5/5 constraint options, 5/5 computed columns
- Coverage: supported 201/259 product diagnostics; product families remaining 58
- Performance: no grammar change in this batch
- Notes: the side-effect phrase is keyed on statement kind, because SQL Server names a statement by
  its kind rather than its spelling, so `CREATE UNIQUE CLUSTERED INDEX` is still "CREATE INDEX".
  `ComputedColumnsConstraintCheckError` follows the documented engine rule: UNIQUE and PRIMARY KEY
  are accepted directly, while CHECK, FOREIGN KEY, and NOT NULL require PERSISTED.

### 2026-08-15 — corpus conformance repairs required by the grammar work

- Status: complete
- Layer: syntax (grammar plus bounded recovery recognition)
- Evidence: full 516/516; zero per-file regressions; aggregate recovery nodes 2,364 → 1,969
- Notes: the corpus guard is per-file monotonic, and recovery-node counts inside fixtures that never
  parsed move whenever the automaton changes. The unsupported syntax behind each moved fixture was
  modelled instead of rebaselining: `SEND ON CONVERSATION` and physical join hints including the
  undocumented `LOCAL` prefix. `SELECT INTO … ON <filegroup>` is separated from CTAS storage so the
  two `ON` clauses cannot compete. ODBC outer joins and security-policy lifecycle statements now
  have structural grammar. Line-leading parenthesized SELECT wrappers use bounded recovery
  recognition because making `(` a general statement starter caused a measured pathological parse
  regression. The baseline was not changed.

### 2026-08-15 — closing measurements for the session

- Tests: 516/516.
- Coverage: supported 201/259 product diagnostics; product families remaining 58.
- Binder benchmark: local scalar p50 7.51 ms p95 9.66 ms; resolved catalog selects p50 12.37 ms
  p95 14.82 ms; missing-object p50 10.69 ms p95 11.24 ms.
- Parser benchmark: 100 KiB cold 178.85 ms warm 130.82 ms, incremental start/middle/end
  17.41/11.90/8.54 ms; 1 MiB cold 1,261.08 ms warm 1,217.96 ms, incremental
  23.78/30.35/27.00 ms; 10 MiB cold 12,762.21 ms warm 12,383.24 ms, incremental
  161.97/162.98/160.09 ms. Against the previous clean measurements (100 KiB cold 170.45 ms, warm
  125.99 ms; 1 MiB cold 1,231.36 ms, warm 1,247.28 ms), the results remain within normal run noise
  while incremental updates are equal or faster.

## Cross-cutting foundations

- [x] Build/deployment-mode profile — `AnalysisProfile` is an explicit immutable setting on bind input and on the in-process runtime, normalized by one resolver, covered by a shared contract suite, and folded into the incremental environment version.
- [x] Index/statistics metadata — `indexState(ref)` is a per-object metadata section carrying index identity, kind, uniqueness, clustering, statistics objects, and columns, plus tri-state `schemaBound` on view metadata; the null, in-memory, simple-query, and dev/query providers and the shared contract suite all implement it.
- [x] Security-object metadata — credentials, certificates, and asymmetric keys are securables in their own section, scoped by database, with completeness that defaults to unknown so absence is only authoritative once a backend publishes them.
- [x] SQL expression type system — no longer a prerequisite for any remaining family. The one type-clash diagnostic in the inventory, `OperandTypeClash`, turned out to be guarded only for non-scalar routine parameters, which declared parameter and variable types already answer; a scalar parameter converts its argument and is never reported. A general conversion, nullability, and operator-applicability model remains worthwhile for editor features, but no catalogued diagnostic now depends on it.
- [x] CLR/UDT member metadata — `clrTypeState(ref)` carries the declaring CLR class, its assembly, whether the type is system-supplied, and its static and instance methods, properties, and fields; every provider and the shared contract suite implement it.
- [x] Collation metadata — `collations()` exposes the server catalog and returns undefined whenever the section is unavailable, so an unavailable list never becomes an invalid-collation result.
- [x] Diagnostic evidence template — every family added in this session ships one exact-output fixture (code, message, severity, and the reported text), the closest valid form, an unrelated-statement guard, a malformed-input guard, each applicable statement form, quoted and multipart names where names are involved, an incomplete-metadata guard for every catalog fact it reads, and a fresh-versus-incremental equivalence test. `test/semantics/diagnostics/index-catalog.test.js` is the fullest worked example.

## Catalog cleanup: not standalone user diagnostics

- [x] `ParseResultsShouldNotContainNullElement` — carries `role: "api-precondition"`; this package exposes no API taking a parse-results collection, so there is no unit-test boundary to retain.
- [x] `CommaOr` — carries `role: "message-fragment"` (", or " joining an expectation tail) and is out of the denominator.
- [x] `Expecting` — carries `role: "message-fragment"` (expectation lead-in text) and is out of the denominator.
- [x] `EndOfFile` — carries `role: "message-fragment"` (EOF location display text) and is out of the denominator.
- [x] `Comma` — carries `role: "message-fragment"` (expectation-list punctuation) and is out of the denominator.
- [x] `Period` — carries `role: "message-fragment"` (multipart-name punctuation) and is out of the denominator.

## Build/deployment-mode validation

- [x] `InvalidBuildModeSqlNullStatement` — every top-level statement that is not a CREATE data-definition statement is named by its statement phrase and reported across the statement; interactive analysis is unaffected.
- [x] `InvalidBuildModeStatementCreateSchema` — CREATE SCHEMA models its schema elements, and a header that owns any element is reported.
- [x] `InvalidBuildModeStatementCreateIndex` — a structural `DROP_EXISTING` option that is bare or `ON` is reported; `OFF` is not.
- [x] `InvalidBuildModeStatementCreateProcCursorParams` — a parsed cursor parameter is reported and outranks the ENCRYPTION option.
- [x] `InvalidBuildModeStatementCreateProcedureWithEncryption` — the classified ENCRYPTION module option is reported across the statement.
- [x] `InvalidBuildModeStatementCreateFunction` — a parsed cursor parameter is reported; a CLR body routes to the statement-phrase message instead.
- [x] `InvalidBuildModeStatementCreateFunctionWithEncryption` — the classified ENCRYPTION module option is reported while SCHEMABINDING and EXECUTE AS stay valid.
- [x] `InvalidBuildModeStatementCreateLogin` — the password form without MUST_CHANGE is reported; certificate, asymmetric key, and Windows logins are not.
- [x] `InvalidBuildModeStatementCreateLoginWithDefaultDatabase` — the parsed `DEFAULT_DATABASE` option is read from the principal option node for both the password and Windows forms.
- [x] `InvalidBuildModeStatementCreateTriggerDdl` — a database or all-server trigger target is reported and outranks the ENCRYPTION option.
- [x] `InvalidBuildModeStatementCreateTriggerWithEncryption` — the classified ENCRYPTION module option is reported for every trigger spelling.
- [x] `InvalidBuildModeStatementCreateViewWithEncryption` — the view option clause is classified so SCHEMABINDING and VIEW_METADATA remain valid.
- [x] `InvalidBuildModeDataTypeUse` — the parsed type name is matched against the build-mode type list and reported at the type node, including alias-prefixed and quoted spellings.
- [x] `InvalidBuildModeExecutionContextTypeSelf` — the parsed module `EXECUTE AS` option is reported at the option when its principal is SELF.

## Structural option and statement validation

- [x] `UnrecognizedOption` — key constraints reject `DROP_EXISTING` and `STATISTICS_ONLY` in every form, and reject `MAXDOP`, `ONLINE`, and `SORT_IN_TEMPDB` inside CREATE TABLE; existing `GenericOptionName` nodes provide exact ranges.
- [x] `InvalidExecuteOption` — the recovery-sensitive EXECUTE tail recognizes only the finite known module-option forms that are illegal there; legal RECOMPILE and RESULT SETS forms remain unchanged, and malformed tails stay syntax-only.
- [x] `InvalidUsageOfIndexOption` — legacy unparenthesized CREATE INDEX WITH syntax accepts its historical standalone flags and assigned FILLFACTOR, and reports every other parsed option precisely at its name.
- [x] `InvalidUsageOfScopedConfiguration` — MAXDOP accepts PRIMARY or a signed integer, the three boolean scoped settings accept ON/OFF/PRIMARY, secondary settings use the same matrix, and unknown settings remain forward-compatible.
- [x] `UnrecognizedCursorOption` — both cursor option lists accept identifier-shaped options so an unmapped spelling can be reported precisely.
- [x] `InvalidUsageOfCursorOption` — the ISO list before CURSOR accepts only INSENSITIVE and SCROLL, and the extended list after CURSOR rejects INSENSITIVE.
- [x] `MixingOldAndNewSyntaxForCursorOptionsNotAllowed` — the grammar models both option lists, and a declaration using both is reported across the declaration.
- [x] `OperatorNotSupported` — ALL is accepted only on UNION; EXCEPT ALL and INTERSECT ALL parse far enough to range the unsupported operator instead of becoming recovery noise.
- [x] `NameOrAuthorizationKeywordRequired` — the grammar models an optional schema name and reports across the statement when neither a name nor `AUTHORIZATION` is present. This also closed a real gap: `CREATE SCHEMA AUTHORIZATION owner` previously failed to parse.
- [x] `InvalidOnClause` — a shared `DropTriggerScope` tail is parsed for DROP forms and rejected for every object kind except triggers.
- [x] `ReadonlyCannotBeUsed` — EXECUTE argument options are structural nodes, so READONLY can be reported at the option without text scanning.
- [x] `InvalidOptionInCreateProcedure` — module options are classified as unrecognized, invalid for the statement kind, or repeated, with the option node providing the range.
- [x] `InvalidOptionInCreateTrigger` — the same structured classification covers CREATE, CREATE OR ALTER, and ALTER trigger forms.
- [x] `InvalidTriggerEventTypes` — syntax validation compares the trigger target scope with the event-list kind and reports at the trigger name. Mixed DML actions and DDL event names remain syntax errors.
- [x] `MaximumSizeErrorForAnyType` — a single length argument is compared with the flat 8000-byte ceiling and reported at the argument literal. Below the ceiling the existing per-type diagnostic applies instead.
- [x] `TypeNameMaxPrefixError` — a three-part type name is rejected and invalidates the specification so no follow-on type diagnostic is emitted. Quoted dots are counted as identifier parts.
- [x] `XmlSchemaCollectionMaxPrefixError` — the same prefix limit is applied to the full XML schema collection name.
- [x] `InvalidGroupByOption` — a legacy `WITH <option>` tail is parsed so only CUBE and ROLLUP are accepted and ranged semantically.
- [x] `NestedDmlMustHaveOutputClause` — a DML statement used as a table source is modelled structurally, and its OUTPUT clause is required before the rowset has any columns.
- [x] `FunctionNotAllowedInOutput` — OUTPUT expressions are walked for user-defined scalar calls, which are rejected only when the catalog proves the function is not schema bound.
- [x] `RequiredParam` — CREATE EXTERNAL STREAM is modelled with its named parameter list, and the data source every stream must declare is required across the statement.
- [x] `DuplicateParam` — the same parameter list reports each repeat after the first at the parameter that repeats.

## General binding and routine semantics

- [x] `ExtendedStoredProceduresNotSupported` — this is parameter-help text rather than a diagnostic: the signature-help provider states it as the return contract of an extended stored procedure, which routine metadata now identifies.
- [x] `StoredProceduresAlwaysReturnInt` — the same seam states the return contract of an ordinary stored procedure in its signature documentation.
- [x] `MultiPartIdentifierBindingError` — a qualified column whose qualifier binds to no rowset is an unbound multi-part identifier; the prefix-mismatch message moved to the qualified star, which is the form the engine reports it for.
- [x] `OperandTypeClash` — the reviewed guard is narrower than a general conversion matrix: it applies only to a non-scalar routine parameter, where a cursor or table-typed argument is not converted and its declared type must be exactly the parameter's type. A scalar parameter converts its argument and is never reported. Both type names must be known, so an undeclared argument variable or an unresolved parameter type reports nothing.
- [x] `InvalidUseOfSideEffectingOperatorWithinFunction` — `ValidateModuleBodyVisitor` names each reported statement by its statement phrase, allows table-variable INSERT/DELETE/MERGE without output rows, never checks UPDATE, and routes SELECT INTO here rather than to the data-returning rule.
- [x] `NotRecognizedFunctionName` — a one-part call can only name a built-in, because a user-defined scalar function must be schema qualified; the reviewed built-in scalar catalog backs the check and aggregates and window functions are excluded as separate catalogs.
- [x] `RemoteFunctionRefIsNotAllowed` — a four-part name in a call position takes precedence over every other result for that call, and stays silent when the last part binds as an ordinary column, because only a UDT or XML column can carry a callable member.

## Index, view, and constraint semantics

- [x] `ColumnIsInvalidForUseAsOrderColumnInIndex` — the columnstore `ORDER (…)` clause is modelled, and a nonclustered index may only order a column it already stores.
- [x] `IndexOrStatisticsExists` — a loaded index set is required; statistics objects share the index namespace and block the name.
- [x] `ClusteredIndexExists` — the object's other clustered index is named, and a replacement frees the slot it occupied.
- [x] `CouldNotFindIndex` — DROP_EXISTING requires the named index to exist in a loaded index set.
- [x] `CannotConvertXmlOrSpatialIndexToRelational` — index kind is modelled, so a non-relational index cannot be replaced by DROP_EXISTING.
- [x] `CannotConvertClusteredIndexToNonclustered` — the existing and requested clustering are compared during DROP_EXISTING.
- [x] `CannotCreateIndexOnViewNotSchemaBound` — only an explicit `schemaBound: false` reports; an unknown binding stays silent.
- [x] `CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex` — an additional view index requires an existing clustered index in a loaded index set.
- [x] `CannotCreateNonuniqueClusteredIndexOnView` — the structural UNIQUE and CLUSTERED words of the index kind decide this, and the engine then continues as though UNIQUE had been written.
- [x] `CannotCreateIndexOnViewContainsInvalidColumns` — the view's loaded column types are inspected once and the target name is ranged.
- [x] `OnlineOperationCannotBePerformedOnIndexInvalidColumns` — a large-value INCLUDE column forces an offline build, which `ONLINE = ON` contradicts.
- [x] `ComputedColumnsConstraintCheckError` — a computed column always accepts UNIQUE and PRIMARY KEY; CHECK, FOREIGN KEY, and NOT NULL require PERSISTED.
- [x] `NoPrimaryKeysInReferencedTable` — an explicit referenced column list is matched against the target's unique indexes compared on key columns only, so an INCLUDE column never satisfies a foreign key; an unloaded index set reports nothing.

## Trigger catalog semantics

- [x] `InvalidTriggerSchema` — the create path compares the qualified trigger schema with the target's schema and ranges only the trigger's schema token.
- [x] `TriggerDoesNotBelongToTarget` — the alter path resolves the object the trigger is attached to and compares stable object identities with the declared target.
- [x] `RequiredInsteadOfTriggerOnView` — the target kind decides this, and INSTEAD OF is read from the tokens that introduce the event list.
- [x] `DuplicateInsteadOfTrigger` — trigger activation metadata is modelled per object, checked in DELETE, INSERT, UPDATE order, and never conflicts a trigger with itself.
- [x] `CannotCreateTriggerOnViewWithCheckOption` — view CHECK OPTION is tri-state metadata, so an unknown value stays silent.
- [x] `CannotCreateInsteadOfTriggerOnTableWithCascade` — foreign key update and delete actions are modelled, and the result needs a loaded constraint set.

## Pivot, UDT, and XML member semantics

- [x] `PrefixedColumnsNotAllowedInPivot` — the PIVOT column list parses multipart names, and a qualified name replaces less useful conflict and duplicate reports.
- [x] `PrefixedColumnsNotAllowedInUnpivot` — only the value and pivoted columns accept the checked shape, so the unpivoted column list stays unqualified.
- [x] `CannotCallMethodsOnType` — the receiver's declared type decides this: a known scalar type that is neither CLR nor XML carries no members, and an undeterminable receiver reports nothing.
- [x] `UdtMemberIsNotStatic` — a static call that resolves to an instance method is reported at the member name.
- [x] `UdtMemberIsStatic` — an instance call that resolves to a static method is reported at the member name.
- [x] `UdtPropertyIsNotStatic` — a static data-member access that resolves to an instance member is reported at the member name.
- [x] `UdtPropertyIsStatic` — an instance data-member access that resolves to a static member is reported at the member name.
- [x] `CouldNotFindPropertyOrField` — only a system CLR type has a complete member list, so only it can prove a data member is absent.
- [x] `CouldNotFindMethod` — the same completeness rule applies to methods, which are a separate namespace from data members.
- [x] `NotValidFunctionOrProperty` — the XML data type exposes a fixed method set and no properties, so any other member name is reported.
- [x] `IncorrectSyntaxToInvokeXmlMethod` — an XML method named without its argument list is the wrong invocation shape and is reported across the whole member expression.

## Security and collation metadata

- [x] `CouldNotFindCredential` — credential lookup is server-scoped through `searchSecurables` and reports only from a ready securables section.
- [x] `CouldNotFindCertificate` — CREATE LOGIN searches the server scope and CREATE USER the current database, so the two never resolve each other's certificates.
- [x] `CouldNotFindAsymmetricKey` — the same scoping applies to asymmetric keys, and absence reports only from a ready section.
- [x] `InvalidCollation` — a parsed `CollateClause` is resolved against the server collation catalog; `database_default` always resolves and an unavailable catalog reports nothing.
