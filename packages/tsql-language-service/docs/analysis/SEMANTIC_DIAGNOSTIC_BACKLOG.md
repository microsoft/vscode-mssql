# T-SQL diagnostic backlog

This is the review checklist for diagnostic work after `DuplicateTriggerActionType`. The inventory
comes from `test/fixtures/tsql-diagnostic-catalog.cjs`; completion is locked by
`test/tsql-diagnostic-coverage.test.js`. Each item names the implementation seam required to finish
it without heuristics. A family is complete only with exact code/message/range tests, valid and
malformed false-positive guards, incremental/full equivalence where syntax-owned, and no new corpus
or direct-binder benchmark regression.

Current mechanical count: **265 catalog entries, 259 product diagnostics, 201 marked supported, 58
product families remaining**. The six non-diagnostic entries now carry an explicit `role` in the
catalog fixture and are excluded from the denominator by
`test/tsql-diagnostic-coverage.test.js`.

## Diagnostic evidence requirements

Exact codes, message templates, report ranges, and supported input shapes must be backed by reviewed
T-SQL behavior and checked-in tests, not recollection. Every new family needs an exact-output fixture,
positive and malformed-input guards, and a short explanation of the observable behavior it preserves.
Public documentation must not depend on private source locations or implementation names.

## Completed in the current batch

- [x] `DuplicateTriggerActionType` — syntax validation scans each undamaged DML trigger action list once, reports every repeated `INSERT`/`UPDATE`/`DELETE` token, and covers CREATE, CREATE OR ALTER, ALTER, incremental updates, DDL-event exclusions, and exact ranges.

## Progress record

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

- [ ] Build/deployment-mode profile — add an explicit immutable setting to syntax/bind input and a shared contract suite before implementing any `InvalidBuildMode*` family.
- [ ] Index/statistics metadata — model index identity, kind, uniqueness, clustering, indexed-view prerequisites, key/include columns, and load completeness in every metadata provider.
- [ ] Security-object metadata — model credentials, certificates, and asymmetric keys as securables with authoritative completeness rather than forcing them into principal kinds.
- [ ] SQL expression type system — add nullability, conversion precedence, operator applicability, function return types, and assignment compatibility before type-clash diagnostics.
- [ ] CLR/UDT member metadata — model static/instance methods, properties, fields, signatures, and declaring SQL type in the provider contract and in-memory contract tests.
- [ ] Collation metadata — expose server/database collations and completeness so an unavailable list never becomes an invalid-collation result.
- [ ] Diagnostic evidence template — require one fixture for exact output plus positive, malformed, quoted-name, statement-form, and incomplete-metadata guards for every family.

## Catalog cleanup: not standalone user diagnostics

- [x] `ParseResultsShouldNotContainNullElement` — carries `role: "api-precondition"`; this package exposes no API taking a parse-results collection, so there is no unit-test boundary to retain.
- [x] `CommaOr` — carries `role: "message-fragment"` (", or " joining an expectation tail) and is out of the denominator.
- [x] `Expecting` — carries `role: "message-fragment"` (expectation lead-in text) and is out of the denominator.
- [x] `EndOfFile` — carries `role: "message-fragment"` (EOF location display text) and is out of the denominator.
- [x] `Comma` — carries `role: "message-fragment"` (expectation-list punctuation) and is out of the denominator.
- [x] `Period` — carries `role: "message-fragment"` (multipart-name punctuation) and is out of the denominator.

## Build/deployment-mode validation

- [ ] `InvalidBuildModeSqlNullStatement` — after the build-mode profile exists, reject statement kinds excluded by that mode at the statement phrase and test normal interactive mode remains unaffected.
- [ ] `InvalidBuildModeStatementCreateSchema` — in build mode, reject CREATE SCHEMA forms containing embedded schema elements while accepting the supported header-only form.
- [ ] `InvalidBuildModeStatementCreateIndex` — in build mode, reject CREATE INDEX with `DROP_EXISTING` after structurally reading that option, without affecting ordinary mode.
- [ ] `InvalidBuildModeStatementCreateProcCursorParams` — in build mode, inspect parsed procedure parameters and reject cursor-typed parameters at the parameter type range.
- [ ] `InvalidBuildModeStatementCreateProcedureWithEncryption` — in build mode, reject procedure `WITH ENCRYPTION` at the option token after option-list validation.
- [ ] `InvalidBuildModeStatementCreateFunction` — encode the exact function shapes unsupported in build mode and diagnose the function declaration only after its body shape is known.
- [ ] `InvalidBuildModeStatementCreateFunctionWithEncryption` — in build mode, reject function `WITH ENCRYPTION` at the option token while leaving supported function options intact.
- [ ] `InvalidBuildModeStatementCreateLogin` — in build mode, classify CREATE LOGIN source forms and reject only the unsupported source at its declaration range.
- [ ] `InvalidBuildModeStatementCreateLoginWithDefaultDatabase` — in build mode, validate `DEFAULT_DATABASE` on CREATE LOGIN using the parsed option rather than text scanning.
- [ ] `InvalidBuildModeStatementCreateTriggerDdl` — in build mode, reject database/all-server DDL trigger definitions after classifying `TriggerTarget`, while preserving DML triggers.
- [ ] `InvalidBuildModeStatementCreateTriggerWithEncryption` — in build mode, reject trigger `WITH ENCRYPTION` at the option token for every applicable trigger spelling.
- [ ] `InvalidBuildModeStatementCreateViewWithEncryption` — in build mode, reject view `WITH ENCRYPTION` at the option token without conflating other view attributes.
- [ ] `InvalidBuildModeDataTypeUse` — add a build-mode type allowlist keyed by parsed type identity and report the unsupported type node, including alias and multipart types.
- [ ] `InvalidBuildModeExecutionContextTypeSelf` — in build mode, validate parsed `EXECUTE AS SELF` module options and range the `SELF` token.

## Structural option and statement validation

- [x] `UnrecognizedOption` — key constraints reject `DROP_EXISTING` and `STATISTICS_ONLY` in every form, and reject `MAXDOP`, `ONLINE`, and `SORT_IN_TEMPDB` inside CREATE TABLE; existing `GenericOptionName` nodes provide exact ranges.
- [ ] `InvalidExecuteOption` — **blocked: not reachable through the accepted EXECUTE grammar.** The `WITH` tail admits only `RECOMPILE` and `RESULT SETS`, so an unexpected option remains a syntax error. Reclassifying this entry as non-reachable needs the same explicit review the six catalog-cleanup entries received.
- [ ] `InvalidUsageOfIndexOption` — define the allowed index-option matrix by statement/index kind and validate each structured option without widening the grammar to arbitrary tails.
- [ ] `InvalidUsageOfScopedConfiguration` — validate primary/secondary and value combinations on structured database-scoped configuration nodes with engine/version gates.
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
- [ ] `NestedDmlMustHaveOutputClause` — detect DML used as a table source and require its structured OUTPUT clause before semantic binding.
- [ ] `FunctionNotAllowedInOutput` — walk OUTPUT expressions and reject the prohibited function categories at their call name while allowing permitted scalar expressions.
- [ ] `RequiredParam` — complete external-stream option grammar, define the required parameter set per statement/engine profile, and report the enclosing option list when one is absent.
- [ ] `DuplicateParam` — scan structured external-stream parameters case-insensitively and report each repeated parameter token after the first.

## General binding and routine semantics

- [ ] `ExtendedStoredProceduresNotSupported` — extend routine metadata to identify extended stored procedures, then diagnose invocation only when authoritative metadata resolves that kind.
- [ ] `StoredProceduresAlwaysReturnInt` — type bound stored-procedure execution results as `int` and diagnose incompatible result assignment through the expression type system.
- [ ] `MultiPartIdentifierBindingError` — complete scope-aware multipart scalar binding and emit this fallback only after alias, column, variable, UDT-member, and catalog resolution all fail authoritatively.
- [ ] `OperandTypeClash` — use the SQL conversion/assignment matrix to compare bound source and destination types, preserving both declared and inferred nullability.
- [x] `InvalidUseOfSideEffectingOperatorWithinFunction` — `ValidateModuleBodyVisitor` names each reported statement by its statement phrase, allows table-variable INSERT/DELETE/MERGE without output rows, never checks UPDATE, and routes SELECT INTO here rather than to the data-returning rule.
- [ ] `NotRecognizedFunctionName` — resolve built-ins by feature profile and user functions through complete metadata/local declarations, emitting only when the relevant catalog is authoritative.
- [ ] `RemoteFunctionRefIsNotAllowed` — **blocked: needs column-candidate binding.** The diagnostic needs both the four-part function name and the identifier considered as a column candidate, and it must stay silent when a non-UDT column binds. Both require complete multipart scalar binding.

## Index, view, and constraint semantics

- [ ] `ColumnIsInvalidForUseAsOrderColumnInIndex` — **blocked: no ORDER clause in the grammar.** Validating a non-clustered index order column against the key columns requires the columnstore `ORDER (…)` clause first.
- [ ] `IndexOrStatisticsExists` — query authoritative index/statistics metadata on CREATE and report a conflicting name scoped to the target object.
- [ ] `ClusteredIndexExists` — use target index metadata to reject creation of a second clustered index, accounting for DROP_EXISTING replacement semantics.
- [ ] `CouldNotFindIndex` — resolve ALTER/DROP/rebuild index names against a complete target index set and remain silent while that section is partial or loading.
- [ ] `CannotConvertXmlOrSpatialIndexToRelational` — model index kind and reject DROP_EXISTING conversion from XML/spatial to relational at the replacement index name.
- [ ] `CannotConvertClusteredIndexToNonclustered` — compare existing and requested index clustering during DROP_EXISTING and diagnose an illegal conversion.
- [ ] `CannotCreateIndexOnViewNotSchemaBound` — add `schemaBound` to view metadata/local view declarations and reject indexed views without it.
- [ ] `CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex` — require an authoritative existing unique clustered index before creating any additional index on a view.
- [ ] `CannotCreateNonuniqueClusteredIndexOnView` — validate that a view's first clustered index is unique using structured UNIQUE/CLUSTERED flags.
- [ ] `CannotCreateIndexOnViewContainsInvalidColumns` — bind the view projection and reject indexed-view keys containing columns whose expression/type metadata makes them ineligible.
- [ ] `OnlineOperationCannotBePerformedOnIndexInvalidColumns` — inspect the resolved index column types and reject ONLINE operations when any participating column is unsupported.
- [x] `ComputedColumnsConstraintCheckError` — a computed column always accepts UNIQUE and PRIMARY KEY; CHECK, FOREIGN KEY, and NOT NULL require PERSISTED.
- [ ] `NoPrimaryKeysInReferencedTable` — **blocked: candidate-key metadata missing.** An explicit referenced column list must match primary and unique keys, but column metadata currently models only `primaryKeyOrdinal`. Reporting without unique-key metadata would falsely flag foreign keys that reference a UNIQUE constraint. The implicit-list case is already covered by `ForeignKeyReferencesImplicitlyTableWithoutPrimaryKey`.

## Trigger catalog semantics

- [ ] `InvalidTriggerSchema` — for the create path only, compare parsed trigger and target schema components, use the target schema when the trigger schema is omitted, and range only the mismatching schema token.
- [ ] `TriggerDoesNotBelongToTarget` — resolve an ALTER trigger and its owning table/view, then compare the declared target using stable object identities rather than names alone.
- [ ] `RequiredInsteadOfTriggerOnView` — resolve the target as a view and require INSTEAD OF where the exact view/trigger rules demand it, remaining silent on incomplete metadata.
- [ ] `DuplicateInsteadOfTrigger` — expose existing trigger activation/action metadata and reject a second INSTEAD OF trigger for the same target action.
- [ ] `CannotCreateTriggerOnViewWithCheckOption` — add view CHECK OPTION metadata/local analysis and reject the prohibited trigger form on such a view.
- [ ] `CannotCreateInsteadOfTriggerOnTableWithCascade` — expose foreign-key cascade actions and reject conflicting INSTEAD OF trigger actions only from an authoritative relationship snapshot.

## Pivot, UDT, and XML member semantics

- [x] `PrefixedColumnsNotAllowedInPivot` — the PIVOT column list parses multipart names, and a qualified name replaces less useful conflict and duplicate reports.
- [x] `PrefixedColumnsNotAllowedInUnpivot` — only the value and pivoted columns accept the checked shape, so the unpivoted column list stays unqualified.
- [ ] `CannotCallMethodsOnType` — bind the receiver SQL type and reject member-call syntax for types that expose no callable instance members.
- [ ] `UdtMemberIsNotStatic` — resolve a CLR/UDT member invoked through a type and report when metadata marks it instance-only.
- [ ] `UdtMemberIsStatic` — resolve a CLR/UDT member invoked through an instance and report when metadata marks it static-only.
- [ ] `UdtPropertyIsNotStatic` — resolve a property through a type reference and report when metadata marks it instance-only.
- [ ] `UdtPropertyIsStatic` — resolve a property through an instance reference and report when metadata marks it static-only.
- [ ] `CouldNotFindPropertyOrField` — after authoritative UDT member hydration, report an unresolved property/field at the member identifier.
- [ ] `CouldNotFindMethod` — after authoritative UDT member hydration and overload lookup, report an unresolved method at the method identifier.
- [ ] `NotValidFunctionOrProperty` — distinguish callable methods, readable properties, and table-valued members, then diagnose invocation syntax incompatible with the resolved member kind.
- [ ] `IncorrectSyntaxToInvokeXmlMethod` — bind XML receivers and validate the required method invocation shape and parentheses at the member expression.

## Security and collation metadata

- [ ] `CouldNotFindCredential` — add credential securable lookup/completeness to every provider and report only a confirmed-absent credential at its identifier.
- [ ] `CouldNotFindCertificate` — add certificate lookup scoped correctly for login/user statements and report only from an authoritative server/database security snapshot.
- [ ] `CouldNotFindAsymmetricKey` — add asymmetric-key lookup scoped correctly for login/user statements and report only a confirmed absence.
- [ ] `InvalidCollation` — resolve a parsed collation name against an authoritative server/database collation catalog and remain silent when that catalog is unavailable or stale.
