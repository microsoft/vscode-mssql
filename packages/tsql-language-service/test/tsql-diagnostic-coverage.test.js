/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const target = require("./fixtures/tsql-diagnostic-catalog.cjs");

// Catalog names that never reach a user as a standalone diagnostic. Each is either an API argument
// precondition or text spliced into another message, so none of them can have a validator and none
// belong in the coverage denominator.
const nonDiagnosticRoles = new Map([
    // An argument check on a parse-results collection, not an analysis result. This package exposes
    // no API that takes such a collection, so it has no unit-test boundary here either.
    ["ParseResultsShouldNotContainNullElement", "api-precondition"],
    // ", or " joining the tail of an expectation list.
    ["CommaOr", "message-fragment"],
    // The "Expecting <list>" lead-in assembled into syntax expectation text.
    ["Expecting", "message-fragment"],
    // Display text for the end-of-file location inside a syntax message.
    ["EndOfFile", "message-fragment"],
    // Punctuation used while composing expectation lists.
    ["Comma", "message-fragment"],
    // Punctuation used while composing multipart-name messages.
    ["Period", "message-fragment"],
]);

// A name enters this set only after a production validator and a focused behavior test exist.
const supported = new Set([
    "AmbiguousColumnName",
    "ApproxNotAllowedWithPercent",
    "ApproxOrderByAliasMismatch",
    "ApproxOrderByMustBeAscending",
    "ApproxOrderByMustReferenceDistance",
    "ApproxRequiresOrderBy",
    "ApproxRequiresSingleOrderByItem",
    "ApproxRequiresVectorSearch",
    "AggregateNotAllowedInOutput",
    "AnchorMemberFoundInRecursiveQuery",
    "Base64Error",
    "BooleanConditionExpected",
    "CannotCreateIdentityOnNullable",
    "CannotCreateDefaultConstraintOnSparseColumn",
    "CannotCreateGeneratedAlwaysColumnNullable",
    "CannotCreateGeneratedAlwaysColumnType",
    "CannotCreateMoreThanOneColumnSetOnTable",
    "CannotCreateMoreThanOneGeneratedAlwaysAsRowEndColumnOnTable",
    "CannotCreateMoreThanOneGeneratedAlwaysAsRowStartColumnOnTable",
    "CannotCreateMoreThanOneTemporalSystemTimePeriodOnTable",
    "CannotCreateSparseColumn",
    "CannotCreateSparseColumnSetOnTable",
    "CannotDefinePrimaryKeyOnNullable",
    "CannotDropObject",
    "CannotFindStoredProcedure",
    "CannotFindUser",
    "CannotHaveDefaultsOnIdentity",
    "CannotPerformAlterOnObject",
    "CannotSpecifyIncludedColumnsForClusteredIndex",
    "CannotUseDrop",
    "ColumnNameNotInTargetTable",
    "ColumnNameConflictsInPivot",
    "ColumnNameConflictsInUnpivot",
    "ColumnNameNotUnique",
    "ColumnPrefixMismatch",
    "ColumnSpecifiedMultipleTimes",
    "ColumnSpecifiedMultipleTimesInUnpivot",
    "CollateCannotBeUsedOnUddt",
    "ColumnConstraintNotUnique",
    "ColumnIsInvalidForUseAsKeyColumnInIndex",
    "ColumnHasInvalidDataType",
    "ColumnHasUserDefinedTableType",
    "ColumnIsNotSameTypeAsRefColumn",
    "CorrelationNameNotUnique",
    "ConflictingReturnsNullAndCalledOnNullInputOptions",
    "ConflictingCursorOption",
    "DatabaseObjectExist",
    "DatabaseNotExist",
    "DatabaseNameAsPrefixInCreateView",
    "DbNameIsNotAllowedForCreateAlterFunc",
    "DbNameIsNotAllowedForCreateAlterProc",
    "DbNameIsNotAllowedForCreateSynonym",
    "DbNameIsNotAllowedForDropSynonym",
    "DuplicateCteName",
    "DuplicateColumnNamesInIndex",
    "DuplicateTriggerActionType",
    "ElementsError",
    "FunctionRequiresAtLeastNumberOfArguments",
    "FunctionRequiresAtLeastOneArgument",
    "FunctionRequiresNumberOfArguments",
    "FunctionRequiresOneArgument",
    "FunctionRequiresRangeOfAruments",
    "FunctionRequiresZeroArguments",
    "FunctionCannotBeUsedToMatchTarget",
    "ForeignKeyInvalidReferencedColumn",
    "ForeignKeyInvalidReferencingColumn",
    "ForeignKeyNumberOfRefColumnsDiffers",
    "ForeignKeyReferencesImplicitlyTableWithoutPrimaryKey",
    "ForeignKeyReferencesInvalidTable",
    "FewerColumns",
    "GeneratedAlwaysAsRowEndColumnDefinitionMissing",
    "GeneratedAlwaysAsRowEndColumnWrongName",
    "GeneratedAlwaysAsRowStartColumnDefinitionMissing",
    "GeneratedAlwaysAsRowStartColumnWrongName",
    "IdentityColumnInvalidType",
    "IncludeNullValuesError",
    "InsufficientArguments",
    "IncorrectSyntaxNear",
    "IncorrectSyntaxNearKeyword",
    "IncorrectOptionOrder",
    "IncorrectOptionValue",
    "IncorrectWhereClauseForFilteredIndex",
    "InsertIntoIdentityColumnNotAllowed",
    "InconsistentParameterFormat",
    "IntegerValueOutOfRange",
    "InvalidOdbcDatetimeExtensionOption",
    "InvalidOptionInCreateView",
    "InvalidOptionInCreateFunction",
    "InvalidOptionInCreateProcedure",
    "InvalidOptionInCreateTrigger",
    "InvalidTriggerEventTypes",
    "InvalidOnClause",
    "NameOrAuthorizationKeywordRequired",
    "ReadonlyCannotBeUsed",
    "MaximumSizeErrorForAnyType",
    "TypeNameMaxPrefixError",
    "XmlSchemaCollectionMaxPrefixError",
    "UnrecognizedCursorOption",
    "InvalidUsageOfCursorOption",
    "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
    "OperatorNotSupported",
    "InvalidGroupByOption",
    "PrefixedColumnsNotAllowedInPivot",
    "PrefixedColumnsNotAllowedInUnpivot",
    "InvalidUseOfSideEffectingOperatorWithinFunction",
    "UnrecognizedOption",
    "ComputedColumnsConstraintCheckError",
    "InvalidColumnName",
    "InvalidColumnXmlNodeUse",
    "InvalidBaseTypeForAlias",
    "InvalidCorrelationNameWithTable",
    "InvalidCorrelationNamesInFrom",
    "InvalidConstantOutput",
    "InvalidFillFactorPercentage",
    "InvalidIndexIncludedColumnType",
    "InvalidIndexKeyColumnType",
    "InvalidLengthOrPrecision",
    "InvalidIncrement",
    "InvalidAggregateFunction",
    "InvalidTableHint",
    "DataTypeMissing",
    "InvalidParameterOne",
    "InvalidObjectName",
    "InvalidParameter",
    "InvalidScale",
    "InvalidSeed",
    "InvalidProcedureNumberRange",
    "LastStatementWithinFunctionMustBeReturn",
    "MaximumPrecisionOutOfRange",
    "MaximumSizeError",
    "MergeStatementMustTerminated",
    "MissingColumn",
    "MissingParameters",
    "MissingSemanticIndexOption",
    "MissingParameter",
    "CouldNotFindLogin",
    "CouldNotLocateDatabase",
    "CouldNotLocateEntryInSysdatabases",
    "MultiplePrimaryKey",
    "MoreColumns",
    "MustBeOnlyStatementInBatch",
    "NoAnchorMemberForRecursiveQuery",
    "NotRecognizedDatePartOption",
    "NotRecognizedIsJsonType",
    "NumberOfColumnsMustBeTheSame",
    "NumberOfValuesDoesNotMatchTableDef",
    "ObjectNotExistOrIsInvalid",
    "ObjectNameIsMissingOrEmpty",
    "ObjectCannotBeModified",
    "OrderByItemContainsVariable",
    "OrderByListHasConstantExpression",
    "OrderByPositionNumberIsOutOfRange",
    "OutOfRangeDegreeOfParallelism",
    "OutputParameterMismatch",
    "OutputIntoTargetCannotBeViewOrCte",
    "OptionNotRecognized",
    "OptionSpecifiedMultipleTimes",
    "ParameterSuppliedMultipleTimes",
    "ParameterCannotBeReadOnly",
    "ParamVarHasInvalidDataType",
    "ParametersSuppliedForNonFunction",
    "ParametersNotSuppliedForFunction",
    "PrimaryKeyNotUnique",
    "RecursiveCteHasNoUnionAll",
    "RecursiveCteMemberHasMultipleRefs",
    "ReturnStatementInScalarValuedFunctionMustIncludeArg",
    "RowguidcolDatatypeMismatch",
    "RowTagOnlyInRawAndPath",
    "ScalarVariableRequired",
    "ScalePrecisionMismatch",
    "SchemaNotExist",
    "SelectAssignmentError",
    "SelectIntoMustBeFirstQuery",
    "SelectListOfInsertHasFewerItems",
    "SelectListOfInsertHasMoreItems",
    "SelectStatementWithinFunctionCannotReturnData",
    "SetClauseColumnSpecifiedMultipleTimes",
    "StatementNotAvailable",
    "SubqueriesNotAllowedInOutput",
    "TableIsAmbiguous",
    "TableConstraintHasNoColumnList",
    "TableVariableRequired",
    "TableValuedParameterMustBeReadOnly",
    "TVFMethodMustBeAliased",
    "TemporalSystemTimePeriodDefinitionMissing",
    "TempFunctionNameIsNotAllowed",
    "TooManyArguments",
    "TypeError",
    "TypeIsNotSystemType",
    "UnclosedQuotationMark",
    "LoginExist",
    "UserExist",
    "UserGroupOrRoleExists",
    "UseDatabaseStatementNotAllowed",
    "UseReturnStatementWithValueCannotBeUsed",
    "UserDefinedTypeExist",
    "VariableNameNotUnique",
    "WithoutArrayWrapperError",
    "XmlSchemaError",
    "ExplicitValueForIdentityColumn",
    "ExpressionTypeInvalidForCollate",
]);

suite("T-SQL diagnostic coverage inventory", () => {
    // Locks the reviewed diagnostic inventory so additions cannot silently change coverage.
    test("contains the 265 active scanner, parser, and binder message families", () => {
        assert.equal(target.length, 265);
        assert.deepEqual(
            Object.fromEntries(
                ["scanner", "parser", "binder"].map((category) => [
                    category,
                    target.filter((entry) => entry.category === category).length,
                ]),
            ),
            { scanner: 1, parser: 14, binder: 250 },
        );
        assert.equal(new Set(target.map(({ name }) => name)).size, target.length);
    });

    // Pins exactly which catalog names are excluded from the denominator, and why, so the coverage
    // ratio cannot be improved by quietly reclassifying a real diagnostic as message text.
    test("excludes only the six reviewed non-diagnostic catalog entries", () => {
        const roleEntries = target.filter((entry) => entry.role !== undefined);
        assert.deepEqual(
            roleEntries.map(({ name, role }) => [name, role]).sort(),
            [...nonDiagnosticRoles].sort(),
        );
        assert.deepEqual([...new Set(roleEntries.map(({ role }) => role))].sort(), [
            "api-precondition",
            "message-fragment",
        ]);
        assert.equal(roleEntries.length, 6);
    });

    // No excluded entry may be claimed as supported: they have no validator to test.
    test("keeps non-diagnostic entries out of the supported set", () => {
        assert.deepEqual(
            [...nonDiagnosticRoles.keys()].filter((name) => supported.has(name)),
            [],
        );
    });

    // Keeps the headline gap reproducible and rejects unsupported names accidentally marked done.
    test("tracks validators with focused regression coverage", () => {
        const targetNames = new Set(target.map(({ name }) => name));
        assert.deepEqual(
            [...supported].filter((name) => !targetNames.has(name)),
            [],
        );
        const productDiagnostics = target.filter((entry) => entry.role === undefined);
        assert.equal(productDiagnostics.length, 259);
        assert.equal(supported.size, 201);
        assert.equal(productDiagnostics.length - supported.size, 58);
    });
});
