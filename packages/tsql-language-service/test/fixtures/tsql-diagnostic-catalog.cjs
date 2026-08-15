/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Reviewed T-SQL diagnostic families used to make coverage progress executable and auditable.
//
// Every entry without a "role" is a product diagnostic: a family the language service is expected
// to emit on its own. The few entries carrying a "role" are message-catalog names that never reach
// a user as an independent diagnostic, so they are excluded from the coverage denominator:
//   - "api-precondition": an argument check on an API boundary, not an analysis result.
//   - "message-fragment": punctuation or clause text assembled into another diagnostic's message.

module.exports = Object.freeze([
    {
        "name": "UnclosedQuotationMark",
        "category": "scanner"
    },
    {
        "name": "IncorrectSyntaxNear",
        "category": "parser"
    },
    {
        "name": "IncorrectSyntaxNearKeyword",
        "category": "parser"
    },
    {
        "name": "IncorrectOptionValue",
        "category": "parser"
    },
    {
        "name": "IncorrectOptionOrder",
        "category": "parser"
    },
    {
        "name": "OptionNotRecognized",
        "category": "parser"
    },
    {
        "name": "OptionSpecifiedMultipleTimes",
        "category": "parser"
    },
    {
        "name": "MaximumPrecisionOutOfRange",
        "category": "parser"
    },
    {
        "name": "MustBeOnlyStatementInBatch",
        "category": "parser"
    },
    {
        "name": "IntegerValueOutOfRange",
        "category": "parser"
    },
    {
        "name": "MergeStatementMustTerminated",
        "category": "parser"
    },
    {
        "name": "CannotPerformAlterOnObject",
        "category": "parser"
    },
    {
        "name": "TypeIsNotSystemType",
        "category": "parser"
    },
    {
        "name": "ParseResultsShouldNotContainNullElement",
        "category": "binder",
        "role": "api-precondition"
    },
    {
        "name": "SchemaNotExist",
        "category": "binder"
    },
    {
        "name": "ColumnSpecifiedMultipleTimes",
        "category": "binder"
    },
    {
        "name": "InvalidObjectName",
        "category": "binder"
    },
    {
        "name": "TooManyArguments",
        "category": "binder"
    },
    {
        "name": "InsufficientArguments",
        "category": "binder"
    },
    {
        "name": "ColumnPrefixMismatch",
        "category": "binder"
    },
    {
        "name": "VariableNameNotUnique",
        "category": "binder"
    },
    {
        "name": "ObjectNotExistOrIsInvalid",
        "category": "binder"
    },
    {
        "name": "CannotCreateSparseColumn",
        "category": "binder"
    },
    {
        "name": "CannotCreateDefaultConstraintOnSparseColumn",
        "category": "binder"
    },
    {
        "name": "ColumnIsInvalidForUseAsKeyColumnInIndex",
        "category": "binder"
    },
    {
        "name": "ColumnIsInvalidForUseAsOrderColumnInIndex",
        "category": "binder"
    },
    {
        "name": "CannotCreateMoreThanOneColumnSetOnTable",
        "category": "binder"
    },
    {
        "name": "CannotCreateSparseColumnSetOnTable",
        "category": "binder"
    },
    {
        "name": "CannotCreateGeneratedAlwaysColumnType",
        "category": "binder"
    },
    {
        "name": "CannotCreateGeneratedAlwaysColumnNullable",
        "category": "binder"
    },
    {
        "name": "CannotCreateMoreThanOneGeneratedAlwaysAsRowStartColumnOnTable",
        "category": "binder"
    },
    {
        "name": "CannotCreateMoreThanOneGeneratedAlwaysAsRowEndColumnOnTable",
        "category": "binder"
    },
    {
        "name": "CannotCreateMoreThanOneTemporalSystemTimePeriodOnTable",
        "category": "binder"
    },
    {
        "name": "GeneratedAlwaysAsRowStartColumnDefinitionMissing",
        "category": "binder"
    },
    {
        "name": "GeneratedAlwaysAsRowEndColumnDefinitionMissing",
        "category": "binder"
    },
    {
        "name": "GeneratedAlwaysAsRowStartColumnWrongName",
        "category": "binder"
    },
    {
        "name": "GeneratedAlwaysAsRowEndColumnWrongName",
        "category": "binder"
    },
    {
        "name": "TemporalSystemTimePeriodDefinitionMissing",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeSqlNullStatement",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateSchema",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateIndex",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateProcCursorParams",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateProcedureWithEncryption",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateFunction",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateFunctionWithEncryption",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateLogin",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateLoginWithDefaultDatabase",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateTriggerDdl",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateTriggerWithEncryption",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeStatementCreateViewWithEncryption",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeDataTypeUse",
        "category": "binder"
    },
    {
        "name": "InvalidBuildModeExecutionContextTypeSelf",
        "category": "binder"
    },
    {
        "name": "UseDatabaseStatementNotAllowed",
        "category": "binder"
    },
    {
        "name": "ExtendedStoredProceduresNotSupported",
        "category": "binder"
    },
    {
        "name": "StoredProceduresAlwaysReturnInt",
        "category": "binder"
    },
    {
        "name": "AmbiguousColumnName",
        "category": "binder"
    },
    {
        "name": "InvalidColumnName",
        "category": "binder"
    },
    {
        "name": "MultiPartIdentifierBindingError",
        "category": "binder"
    },
    {
        "name": "InvalidColumnXmlNodeUse",
        "category": "binder"
    },
    {
        "name": "TVFMethodMustBeAliased",
        "category": "binder"
    },
    {
        "name": "DatabaseNotExist",
        "category": "binder"
    },
    {
        "name": "DatabaseObjectExist",
        "category": "binder"
    },
    {
        "name": "UnrecognizedOption",
        "category": "binder"
    },
    {
        "name": "MoreColumns",
        "category": "binder"
    },
    {
        "name": "FewerColumns",
        "category": "binder"
    },
    {
        "name": "CouldNotLocateDatabase",
        "category": "binder"
    },
    {
        "name": "CannotFindStoredProcedure",
        "category": "binder"
    },
    {
        "name": "MissingParameters",
        "category": "binder"
    },
    {
        "name": "InvalidParameter",
        "category": "binder"
    },
    {
        "name": "ParameterSuppliedMultipleTimes",
        "category": "binder"
    },
    {
        "name": "OutputParameterMismatch",
        "category": "binder"
    },
    {
        "name": "MissingParameter",
        "category": "binder"
    },
    {
        "name": "InconsistentParameterFormat",
        "category": "binder"
    },
    {
        "name": "InvalidExecuteOption",
        "category": "binder"
    },
    {
        "name": "MissingColumn",
        "category": "binder"
    },
    {
        "name": "InvalidUsageOfIndexOption",
        "category": "binder"
    },
    {
        "name": "InvalidUsageOfScopedConfiguration",
        "category": "binder"
    },
    {
        "name": "UnrecognizedCursorOption",
        "category": "binder"
    },
    {
        "name": "InvalidUsageOfCursorOption",
        "category": "binder"
    },
    {
        "name": "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
        "category": "binder"
    },
    {
        "name": "ConflictingCursorOption",
        "category": "binder"
    },
    {
        "name": "IndexOrStatisticsExists",
        "category": "binder"
    },
    {
        "name": "ClusteredIndexExists",
        "category": "binder"
    },
    {
        "name": "CouldNotFindIndex",
        "category": "binder"
    },
    {
        "name": "CannotConvertXmlOrSpatialIndexToRelational",
        "category": "binder"
    },
    {
        "name": "CannotConvertClusteredIndexToNonclustered",
        "category": "binder"
    },
    {
        "name": "CannotCreateIndexOnViewNotSchemaBound",
        "category": "binder"
    },
    {
        "name": "CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex",
        "category": "binder"
    },
    {
        "name": "CannotCreateNonuniqueClusteredIndexOnView",
        "category": "binder"
    },
    {
        "name": "InvalidIndexKeyColumnType",
        "category": "binder"
    },
    {
        "name": "InvalidIndexIncludedColumnType",
        "category": "binder"
    },
    {
        "name": "CannotCreateIndexOnViewContainsInvalidColumns",
        "category": "binder"
    },
    {
        "name": "OnlineOperationCannotBePerformedOnIndexInvalidColumns",
        "category": "binder"
    },
    {
        "name": "CannotSpecifyIncludedColumnsForClusteredIndex",
        "category": "binder"
    },
    {
        "name": "InvalidFillFactorPercentage",
        "category": "binder"
    },
    {
        "name": "IncorrectWhereClauseForFilteredIndex",
        "category": "binder"
    },
    {
        "name": "ParamVarHasInvalidDataType",
        "category": "binder"
    },
    {
        "name": "ColumnHasInvalidDataType",
        "category": "binder"
    },
    {
        "name": "OutOfRangeDegreeOfParallelism",
        "category": "binder"
    },
    {
        "name": "ParameterCannotBeReadOnly",
        "category": "binder"
    },
    {
        "name": "TableValuedParameterMustBeReadOnly",
        "category": "binder"
    },
    {
        "name": "OperandTypeClash",
        "category": "binder"
    },
    {
        "name": "ScalarVariableRequired",
        "category": "binder"
    },
    {
        "name": "ColumnNameNotUnique",
        "category": "binder"
    },
    {
        "name": "MultiplePrimaryKey",
        "category": "binder"
    },
    {
        "name": "CorrelationNameNotUnique",
        "category": "binder"
    },
    {
        "name": "InvalidCorrelationNameWithTable",
        "category": "binder"
    },
    {
        "name": "InvalidCorrelationNamesInFrom",
        "category": "binder"
    },
    {
        "name": "ParametersNotSuppliedForFunction",
        "category": "binder"
    },
    {
        "name": "TableIsAmbiguous",
        "category": "binder"
    },
    {
        "name": "ParametersSuppliedForNonFunction",
        "category": "binder"
    },
    {
        "name": "FunctionCannotBeUsedToMatchTarget",
        "category": "binder"
    },
    {
        "name": "ObjectCannotBeModified",
        "category": "binder"
    },
    {
        "name": "TableVariableRequired",
        "category": "binder"
    },
    {
        "name": "OperatorNotSupported",
        "category": "binder"
    },
    {
        "name": "BooleanConditionExpected",
        "category": "binder"
    },
    {
        "name": "DataTypeMissing",
        "category": "binder"
    },
    {
        "name": "ColumnConstraintNotUnique",
        "category": "binder"
    },
    {
        "name": "PrimaryKeyNotUnique",
        "category": "binder"
    },
    {
        "name": "CannotHaveDefaultsOnIdentity",
        "category": "binder"
    },
    {
        "name": "CannotCreateIdentityOnNullable",
        "category": "binder"
    },
    {
        "name": "CannotDefinePrimaryKeyOnNullable",
        "category": "binder"
    },
    {
        "name": "RowguidcolDatatypeMismatch",
        "category": "binder"
    },
    {
        "name": "ColumnHasUserDefinedTableType",
        "category": "binder"
    },
    {
        "name": "InvalidSeed",
        "category": "binder"
    },
    {
        "name": "InvalidIncrement",
        "category": "binder"
    },
    {
        "name": "IdentityColumnInvalidType",
        "category": "binder"
    },
    {
        "name": "ComputedColumnsConstraintCheckError",
        "category": "binder"
    },
    {
        "name": "ColumnNameNotInTargetTable",
        "category": "binder"
    },
    {
        "name": "ForeignKeyReferencesInvalidTable",
        "category": "binder"
    },
    {
        "name": "ForeignKeyNumberOfRefColumnsDiffers",
        "category": "binder"
    },
    {
        "name": "NoPrimaryKeysInReferencedTable",
        "category": "binder"
    },
    {
        "name": "ForeignKeyReferencesImplicitlyTableWithoutPrimaryKey",
        "category": "binder"
    },
    {
        "name": "ColumnIsNotSameTypeAsRefColumn",
        "category": "binder"
    },
    {
        "name": "ForeignKeyInvalidReferencingColumn",
        "category": "binder"
    },
    {
        "name": "ForeignKeyInvalidReferencedColumn",
        "category": "binder"
    },
    {
        "name": "NameOrAuthorizationKeywordRequired",
        "category": "binder"
    },
    {
        "name": "InvalidOnClause",
        "category": "binder"
    },
    {
        "name": "InvalidOptionInCreateFunction",
        "category": "binder"
    },
    {
        "name": "DbNameIsNotAllowedForCreateAlterFunc",
        "category": "binder"
    },
    {
        "name": "ConflictingReturnsNullAndCalledOnNullInputOptions",
        "category": "binder"
    },
    {
        "name": "LastStatementWithinFunctionMustBeReturn",
        "category": "binder"
    },
    {
        "name": "ReturnStatementInScalarValuedFunctionMustIncludeArg",
        "category": "binder"
    },
    {
        "name": "UseReturnStatementWithValueCannotBeUsed",
        "category": "binder"
    },
    {
        "name": "InvalidUseOfSideEffectingOperatorWithinFunction",
        "category": "binder"
    },
    {
        "name": "SelectStatementWithinFunctionCannotReturnData",
        "category": "binder"
    },
    {
        "name": "TempFunctionNameIsNotAllowed",
        "category": "binder"
    },
    {
        "name": "ObjectNameIsMissingOrEmpty",
        "category": "binder"
    },
    {
        "name": "InvalidConstantOutput",
        "category": "binder"
    },
    {
        "name": "ReadonlyCannotBeUsed",
        "category": "binder"
    },
    {
        "name": "InvalidOptionInCreateProcedure",
        "category": "binder"
    },
    {
        "name": "InvalidProcedureNumberRange",
        "category": "binder"
    },
    {
        "name": "DbNameIsNotAllowedForCreateAlterProc",
        "category": "binder"
    },
    {
        "name": "DbNameIsNotAllowedForCreateSynonym",
        "category": "binder"
    },
    {
        "name": "DbNameIsNotAllowedForDropSynonym",
        "category": "binder"
    },
    {
        "name": "InvalidOptionInCreateTrigger",
        "category": "binder"
    },
    {
        "name": "InvalidTriggerEventTypes",
        "category": "binder"
    },
    {
        "name": "DuplicateTriggerActionType",
        "category": "binder"
    },
    {
        "name": "InvalidTriggerSchema",
        "category": "binder"
    },
    {
        "name": "TriggerDoesNotBelongToTarget",
        "category": "binder"
    },
    {
        "name": "RequiredInsteadOfTriggerOnView",
        "category": "binder"
    },
    {
        "name": "DuplicateInsteadOfTrigger",
        "category": "binder"
    },
    {
        "name": "CannotCreateTriggerOnViewWithCheckOption",
        "category": "binder"
    },
    {
        "name": "CannotCreateInsteadOfTriggerOnTableWithCascade",
        "category": "binder"
    },
    {
        "name": "InvalidLengthOrPrecision",
        "category": "binder"
    },
    {
        "name": "InvalidScale",
        "category": "binder"
    },
    {
        "name": "ScalePrecisionMismatch",
        "category": "binder"
    },
    {
        "name": "MaximumSizeError",
        "category": "binder"
    },
    {
        "name": "MaximumSizeErrorForAnyType",
        "category": "binder"
    },
    {
        "name": "TypeNameMaxPrefixError",
        "category": "binder"
    },
    {
        "name": "XmlSchemaCollectionMaxPrefixError",
        "category": "binder"
    },
    {
        "name": "SelectAssignmentError",
        "category": "binder"
    },
    {
        "name": "SelectIntoMustBeFirstQuery",
        "category": "binder"
    },
    {
        "name": "InvalidTableHint",
        "category": "binder"
    },
    {
        "name": "TableConstraintHasNoColumnList",
        "category": "binder"
    },
    {
        "name": "DuplicateColumnNamesInIndex",
        "category": "binder"
    },
    {
        "name": "InvalidOptionInCreateView",
        "category": "binder"
    },
    {
        "name": "DatabaseNameAsPrefixInCreateView",
        "category": "binder"
    },
    {
        "name": "NotRecognizedFunctionName",
        "category": "binder"
    },
    {
        "name": "RemoteFunctionRefIsNotAllowed",
        "category": "binder"
    },
    {
        "name": "RowTagOnlyInRawAndPath",
        "category": "binder"
    },
    {
        "name": "XmlSchemaError",
        "category": "binder"
    },
    {
        "name": "ElementsError",
        "category": "binder"
    },
    {
        "name": "Base64Error",
        "category": "binder"
    },
    {
        "name": "TypeError",
        "category": "binder"
    },
    {
        "name": "IncludeNullValuesError",
        "category": "binder"
    },
    {
        "name": "WithoutArrayWrapperError",
        "category": "binder"
    },
    {
        "name": "InvalidGroupByOption",
        "category": "binder"
    },
    {
        "name": "CommaOr",
        "category": "binder",
        "role": "message-fragment"
    },
    {
        "name": "Expecting",
        "category": "binder",
        "role": "message-fragment"
    },
    {
        "name": "EndOfFile",
        "category": "binder",
        "role": "message-fragment"
    },
    {
        "name": "Comma",
        "category": "binder",
        "role": "message-fragment"
    },
    {
        "name": "Period",
        "category": "binder",
        "role": "message-fragment"
    },
    {
        "name": "CannotDropObject",
        "category": "binder"
    },
    {
        "name": "CannotUseDrop",
        "category": "binder"
    },
    {
        "name": "CouldNotLocateEntryInSysdatabases",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresNumberOfArguments",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresOneArgument",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresRangeOfAruments",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresZeroArguments",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresAtLeastNumberOfArguments",
        "category": "binder"
    },
    {
        "name": "FunctionRequiresAtLeastOneArgument",
        "category": "binder"
    },
    {
        "name": "InvalidParameterOne",
        "category": "binder"
    },
    {
        "name": "NotRecognizedDatePartOption",
        "category": "binder"
    },
    {
        "name": "NotRecognizedIsJsonType",
        "category": "binder"
    },
    {
        "name": "InvalidAggregateFunction",
        "category": "binder"
    },
    {
        "name": "DuplicateCteName",
        "category": "binder"
    },
    {
        "name": "RecursiveCteHasNoUnionAll",
        "category": "binder"
    },
    {
        "name": "NoAnchorMemberForRecursiveQuery",
        "category": "binder"
    },
    {
        "name": "RecursiveCteMemberHasMultipleRefs",
        "category": "binder"
    },
    {
        "name": "AnchorMemberFoundInRecursiveQuery",
        "category": "binder"
    },
    {
        "name": "PrefixedColumnsNotAllowedInPivot",
        "category": "binder"
    },
    {
        "name": "ColumnNameConflictsInPivot",
        "category": "binder"
    },
    {
        "name": "PrefixedColumnsNotAllowedInUnpivot",
        "category": "binder"
    },
    {
        "name": "ColumnNameConflictsInUnpivot",
        "category": "binder"
    },
    {
        "name": "ColumnSpecifiedMultipleTimesInUnpivot",
        "category": "binder"
    },
    {
        "name": "OrderByItemContainsVariable",
        "category": "binder"
    },
    {
        "name": "OrderByPositionNumberIsOutOfRange",
        "category": "binder"
    },
    {
        "name": "OrderByListHasConstantExpression",
        "category": "binder"
    },
    {
        "name": "SetClauseColumnSpecifiedMultipleTimes",
        "category": "binder"
    },
    {
        "name": "OutputIntoTargetCannotBeViewOrCte",
        "category": "binder"
    },
    {
        "name": "NumberOfValuesDoesNotMatchTableDef",
        "category": "binder"
    },
    {
        "name": "SelectListOfInsertHasFewerItems",
        "category": "binder"
    },
    {
        "name": "SelectListOfInsertHasMoreItems",
        "category": "binder"
    },
    {
        "name": "InsertIntoIdentityColumnNotAllowed",
        "category": "binder"
    },
    {
        "name": "NestedDmlMustHaveOutputClause",
        "category": "binder"
    },
    {
        "name": "SubqueriesNotAllowedInOutput",
        "category": "binder"
    },
    {
        "name": "AggregateNotAllowedInOutput",
        "category": "binder"
    },
    {
        "name": "FunctionNotAllowedInOutput",
        "category": "binder"
    },
    {
        "name": "ExplicitValueForIdentityColumn",
        "category": "binder"
    },
    {
        "name": "NumberOfColumnsMustBeTheSame",
        "category": "binder"
    },
    {
        "name": "CannotCallMethodsOnType",
        "category": "binder"
    },
    {
        "name": "UdtMemberIsNotStatic",
        "category": "binder"
    },
    {
        "name": "UdtMemberIsStatic",
        "category": "binder"
    },
    {
        "name": "UdtPropertyIsNotStatic",
        "category": "binder"
    },
    {
        "name": "UdtPropertyIsStatic",
        "category": "binder"
    },
    {
        "name": "CouldNotFindPropertyOrField",
        "category": "binder"
    },
    {
        "name": "CouldNotFindMethod",
        "category": "binder"
    },
    {
        "name": "NotValidFunctionOrProperty",
        "category": "binder"
    },
    {
        "name": "IncorrectSyntaxToInvokeXmlMethod",
        "category": "binder"
    },
    {
        "name": "LoginExist",
        "category": "binder"
    },
    {
        "name": "UserExist",
        "category": "binder"
    },
    {
        "name": "CouldNotFindCredential",
        "category": "binder"
    },
    {
        "name": "CouldNotFindCertificate",
        "category": "binder"
    },
    {
        "name": "CouldNotFindAsymmetricKey",
        "category": "binder"
    },
    {
        "name": "CouldNotFindLogin",
        "category": "binder"
    },
    {
        "name": "UserDefinedTypeExist",
        "category": "binder"
    },
    {
        "name": "InvalidBaseTypeForAlias",
        "category": "binder"
    },
    {
        "name": "CannotFindUser",
        "category": "binder"
    },
    {
        "name": "UserGroupOrRoleExists",
        "category": "binder"
    },
    {
        "name": "RequiredParam",
        "category": "binder"
    },
    {
        "name": "DuplicateParam",
        "category": "binder"
    },
    {
        "name": "InvalidCollation",
        "category": "binder"
    },
    {
        "name": "ExpressionTypeInvalidForCollate",
        "category": "binder"
    },
    {
        "name": "CollateCannotBeUsedOnUddt",
        "category": "binder"
    },
    {
        "name": "InvalidOdbcDatetimeExtensionOption",
        "category": "parser"
    },
    {
        "name": "StatementNotAvailable",
        "category": "parser"
    },
    {
        "name": "ApproxRequiresVectorSearch",
        "category": "binder"
    },
    {
        "name": "ApproxRequiresOrderBy",
        "category": "binder"
    },
    {
        "name": "ApproxRequiresSingleOrderByItem",
        "category": "binder"
    },
    {
        "name": "ApproxOrderByMustReferenceDistance",
        "category": "binder"
    },
    {
        "name": "ApproxOrderByAliasMismatch",
        "category": "binder"
    },
    {
        "name": "ApproxOrderByMustBeAscending",
        "category": "binder"
    },
    {
        "name": "ApproxNotAllowedWithPercent",
        "category": "binder"
    },
    {
        "name": "MissingSemanticIndexOption",
        "category": "binder"
    }
]);
