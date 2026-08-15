# T-SQL diagnostic backlog

This is the review checklist for diagnostic work after `DuplicateTriggerActionType`. The inventory
comes from `test/fixtures/tsql-diagnostic-catalog.cjs`; completion is locked by
`test/tsql-diagnostic-coverage.test.js`. Each item names the implementation seam required to finish
it without heuristics. A family is complete only with exact code/message/range tests, valid and
malformed false-positive guards, incremental/full equivalence where syntax-owned, and no new corpus
or direct-binder benchmark regression.

Current mechanical count: **265 catalog entries, 182 marked supported, 83 entries below**. Six of
the 83 are confirmed internal messages or message fragments, so the remaining product-diagnostic
work is at most 77 families; the denominator must be corrected only after the cleanup items land.

## Completed in the current batch

- [x] `DuplicateTriggerActionType` — syntax validation scans each undamaged DML trigger action list once, reports every repeated `INSERT`/`UPDATE`/`DELETE` token, and covers CREATE, CREATE OR ALTER, ALTER, incremental updates, DDL-event exclusions, and exact ranges.

## Cross-cutting foundations

- [ ] Build/deployment-mode profile — add an explicit immutable setting to syntax/bind input and a shared contract suite before implementing any `InvalidBuildMode*` family.
- [ ] Index/statistics metadata — model index identity, kind, uniqueness, clustering, indexed-view prerequisites, key/include columns, and load completeness in every metadata provider.
- [ ] Security-object metadata — model credentials, certificates, and asymmetric keys as securables with authoritative completeness rather than forcing them into principal kinds.
- [ ] SQL expression type system — add nullability, conversion precedence, operator applicability, function return types, and assignment compatibility before type-clash diagnostics.
- [ ] CLR/UDT member metadata — model static/instance methods, properties, fields, signatures, and declaring SQL type in the provider contract and in-memory contract tests.
- [ ] Collation metadata — expose server/database collations and completeness so an unavailable list never becomes an invalid-collation result.
- [ ] Diagnostic evidence template — require one fixture for exact output plus positive, malformed, quoted-name, statement-form, and incomplete-metadata guards for every family.

## Catalog cleanup: not standalone user diagnostics

- [ ] `ParseResultsShouldNotContainNullElement` — remove from the product-diagnostic target because it is an API argument precondition, retaining an ordinary unit test at its API boundary if that API exists here.
- [ ] `CommaOr` — reclassify as a syntax-message fragment and remove it from the standalone coverage denominator.
- [ ] `Expecting` — reclassify as a syntax-message fragment assembled into expectation text and remove it from the standalone denominator.
- [ ] `EndOfFile` — reclassify as the display text for an EOF syntax location, not an independently emitted diagnostic family.
- [ ] `Comma` — reclassify as punctuation used while composing expectation lists and remove it from the standalone denominator.
- [ ] `Period` — reclassify as punctuation used while composing messages and remove it from the standalone denominator.

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

- [ ] `UnrecognizedOption` — let the relevant unique/index constraint option grammar preserve unknown option nodes, then validate names contextually and range the unknown option.
- [ ] `InvalidExecuteOption` — classify every parsed EXECUTE module option by execution form and reject options illegal for that form at the option node.
- [ ] `InvalidUsageOfIndexOption` — define the allowed index-option matrix by statement/index kind and validate each structured option without widening the grammar to arbitrary tails.
- [ ] `InvalidUsageOfScopedConfiguration` — validate primary/secondary and value combinations on structured database-scoped configuration nodes with engine/version gates.
- [ ] `UnrecognizedCursorOption` — extend `CursorOption` with a recoverable identifier alternative, then reject unknown names while preserving exact token ranges.
- [ ] `InvalidUsageOfCursorOption` — classify recognized cursor options by declaration/API context and diagnose options not allowed in that specific context.
- [ ] `MixingOldAndNewSyntaxForCursorOptionsNotAllowed` — add `INSENSITIVE` and legacy option nodes, then reject a declaration that combines legacy and ISO cursor-option families.
- [ ] `OperatorNotSupported` — validate parsed set/query operator kinds against the supported feature profile and report the operator token, not a later recovery node.
- [ ] `NameOrAuthorizationKeywordRequired` — add a CREATE SCHEMA structural validator requiring either a schema name or `AUTHORIZATION`, with malformed-prefix range tests.
- [ ] `InvalidOnClause` — classify DROP statement kinds that permit `ON DATABASE`/`ON ALL SERVER` and report an illegal structured ON clause.
- [ ] `ReadonlyCannotBeUsed` — validate READONLY on structured EXECUTE arguments and report it where the argument form does not permit the modifier.
- [ ] `InvalidOptionInCreateProcedure` — validate procedure options against the procedure option matrix and range only the unsupported option.
- [ ] `InvalidOptionInCreateTrigger` — validate trigger options against the trigger option matrix for CREATE, CREATE OR ALTER, and ALTER forms.
- [ ] `InvalidTriggerEventTypes` — compare structured trigger target scope with DML versus DDL event nodes and report incompatible event kinds without catalog access.
- [ ] `MaximumSizeErrorForAnyType` — centralize built-in type size bounds and validate numeric/MAX arguments on the parsed data-type specification.
- [ ] `TypeNameMaxPrefixError` — validate the maximum multipart prefix count for each type/index context using identifier components, including quoted dots.
- [ ] `XmlSchemaCollectionMaxPrefixError` — validate XML schema collection multipart depth on its structured type argument and range the full invalid collection name.
- [ ] `InvalidGroupByOption` — validate GROUP BY option combinations from grouping nodes and compatibility profile, reporting the invalid option token.
- [ ] `NestedDmlMustHaveOutputClause` — detect DML used as a table source and require its structured OUTPUT clause before semantic binding.
- [ ] `FunctionNotAllowedInOutput` — walk OUTPUT expressions and reject the prohibited function categories at their call name while allowing permitted scalar expressions.
- [ ] `RequiredParam` — complete external-stream option grammar, define the required parameter set per statement/engine profile, and report the enclosing option list when one is absent.
- [ ] `DuplicateParam` — scan structured external-stream parameters case-insensitively and report each repeated parameter token after the first.

## General binding and routine semantics

- [ ] `ExtendedStoredProceduresNotSupported` — extend routine metadata to identify extended stored procedures, then diagnose invocation only when authoritative metadata resolves that kind.
- [ ] `StoredProceduresAlwaysReturnInt` — type bound stored-procedure execution results as `int` and diagnose incompatible result assignment through the expression type system.
- [ ] `MultiPartIdentifierBindingError` — complete scope-aware multipart scalar binding and emit this fallback only after alias, column, variable, UDT-member, and catalog resolution all fail authoritatively.
- [ ] `OperandTypeClash` — use the SQL conversion/assignment matrix to compare bound source and destination types, preserving both declared and inferred nullability.
- [ ] `InvalidUseOfSideEffectingOperatorWithinFunction` — walk each function body, classify side-effecting statements/operators, and report them while excluding nested module definitions and permitted table-variable work.
- [ ] `NotRecognizedFunctionName` — resolve built-ins by feature profile and user functions through complete metadata/local declarations, emitting only when the relevant catalog is authoritative.
- [ ] `RemoteFunctionRefIsNotAllowed` — detect four-part user-function calls after multipart binding and report the remote server/database prefix at the function reference.

## Index, view, and constraint semantics

- [ ] `ColumnIsInvalidForUseAsOrderColumnInIndex` — bind each index order column to the target shape and reject unsupported data types or column attributes using the shared index type policy.
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
- [ ] `ComputedColumnsConstraintCheckError` — bind computed-column expressions and reject constraints that are illegal on computed columns at the constraint node.
- [ ] `NoPrimaryKeysInReferencedTable` — when a foreign key omits referenced columns, require authoritative primary-key ordinals on the referenced table and report the referenced table if absent.

## Trigger catalog semantics

- [ ] `InvalidTriggerSchema` — for the create path only, compare parsed trigger and target schema components, use the target schema when the trigger schema is omitted, and range only the mismatching schema token.
- [ ] `TriggerDoesNotBelongToTarget` — resolve an ALTER trigger and its owning table/view, then compare the declared target using stable object identities rather than names alone.
- [ ] `RequiredInsteadOfTriggerOnView` — resolve the target as a view and require INSTEAD OF where the exact view/trigger rules demand it, remaining silent on incomplete metadata.
- [ ] `DuplicateInsteadOfTrigger` — expose existing trigger activation/action metadata and reject a second INSTEAD OF trigger for the same target action.
- [ ] `CannotCreateTriggerOnViewWithCheckOption` — add view CHECK OPTION metadata/local analysis and reject the prohibited trigger form on such a view.
- [ ] `CannotCreateInsteadOfTriggerOnTableWithCascade` — expose foreign-key cascade actions and reject conflicting INSTEAD OF trigger actions only from an authoritative relationship snapshot.

## Pivot, UDT, and XML member semantics

- [ ] `PrefixedColumnsNotAllowedInPivot` — inspect PIVOT value/grouping references and report qualified column nodes where the construct requires an unqualified name.
- [ ] `PrefixedColumnsNotAllowedInUnpivot` — inspect UNPIVOT source-column references and report qualified column nodes where only unqualified names are legal.
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
