/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView, ObjectMetadata } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxToken } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import {
    compactMultipartName,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import { hasDropExistingIndexOption } from "./buildModeDiagnostics.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import {
    hasBooleanOperator,
    indexColumnTypeFacts,
    integerIndexOption,
    isCreateClusteredIndex,
} from "./diagnosticTextFacts.js";

export interface IndexDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    relationColumnsAt(
        parts: readonly string[],
        offset: number,
    ): readonly ColumnMetadata[] | undefined;
    localRelationKnownAt(parts: readonly string[], offset: number): boolean;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
    fold(value: string): string;
    equal(left: string, right: string): boolean;
}

/** Validates CREATE INDEX shape, options, columns, and authoritative catalog constraints. */
export function validateIndexes(context: IndexDiagnosticContext): void {
    for (const index of context.nodes("CreateIndexStatement")) {
        const target = firstDescendantOfKind(index, "MultipartIdentifier");
        const indexNameNode = firstDescendantOfKind(index, "IdentifierName");
        if (!target || !indexNameNode) continue;
        const targetName = compactMultipartName(context.source(target));
        const targetColumns = context.relationColumnsAt(
            multipartIdentifierParts(targetName),
            index.start,
        );
        const keyList = firstDescendantOfKind(index, "IndexColumnList");
        const include = firstDescendantOfKind(index, "IncludeClause");
        const keyColumns = keyList
            ? descendantsOfKind(keyList, "IndexColumn").flatMap((column) => {
                  const name = firstDescendantOfKind(column, "IdentifierName");
                  return name ? [name] : [];
              })
            : [];
        const includedColumns = include ? descendantsOfKind(include, "IdentifierName") : [];
        const seen = new Set<string>();
        for (const column of [...keyColumns, ...includedColumns]) {
            const name = normalizeIdentifier(context.source(column));
            const key = context.fold(name);
            if (seen.has(key)) {
                context.add(
                    "DuplicateColumnNamesInIndex",
                    `Cannot use duplicate column names in index. Column name '${name}' listed more than once.`,
                    column,
                );
            }
            seen.add(key);
            const metadata = targetColumns?.find((candidate) =>
                context.equal(candidate.name, name),
            );
            if (targetColumns && !metadata) {
                context.add(
                    "ColumnNameNotInTargetTable",
                    `Column name '${name}' does not exist in the target table or view.`,
                    column,
                );
                continue;
            }
            if (!metadata?.typeDisplay) continue;
            const typeFacts = indexColumnTypeFacts(metadata.typeDisplay);
            const included = includedColumns.some(
                (candidate) => candidate.start === column.start && candidate.end === column.end,
            );
            if ((included && !typeFacts.validIncluded) || (!included && !typeFacts.validKey)) {
                context.add(
                    included ? "InvalidIndexIncludedColumnType" : "InvalidIndexKeyColumnType",
                    included
                        ? ` Column '${name}' in table '${targetName}' is of a type that is invalid for use as included column in an index.`
                        : `Column '${name}' in table '${targetName}' is of a type that is invalid for use as a key column in an index.`,
                    column,
                );
            }
        }
        const source = context.source(index);
        if (isCreateClusteredIndex(source) && include) {
            context.add(
                "CannotSpecifyIncludedColumnsForClusteredIndex",
                "Cannot specify included columns for a clustered index.",
                indexNameNode,
            );
        }
        for (const option of descendantsOfKind(index, "GenericOption")) {
            const optionSource = context.source(option);
            const fillFactor = integerIndexOption(optionSource, "FILLFACTOR");
            if (fillFactor !== undefined && (fillFactor < 1 || fillFactor > 100)) {
                context.add(
                    "InvalidFillFactorPercentage",
                    `Fillfactor ${fillFactor} is not a valid percentage; fillfactor must be between 1 and 100.`,
                    option,
                );
            }
            const maxDop = integerIndexOption(optionSource, "MAXDOP");
            if (maxDop !== undefined && (maxDop < 0 || maxDop > 64)) {
                context.add(
                    "OutOfRangeDegreeOfParallelism",
                    `'${maxDop}' is out of range for index option 'maxdop'. See sp_configure option 'max degree of parallelism' for valid values.`,
                    option,
                );
            }
        }
        const where = firstDescendantOfKind(index, "WhereClause");
        if (where) {
            const expression = firstDescendantOfKind(where, "Expression");
            if (!expression || !hasBooleanOperator(context.source(expression))) {
                const indexName = normalizeIdentifier(context.source(indexNameNode));
                context.add(
                    "IncorrectWhereClauseForFilteredIndex",
                    `Incorrect WHERE clause for filtered index '${indexName}' on table '${targetName}'.`,
                    where,
                );
            }
        }
    }
    validateIndexCatalog(context);
    for (const index of context.nodes("CreateSemanticIndexStatement")) {
        if (firstDescendantOfKind(index, "SemanticExternalModel")) continue;
        const withClause = firstDescendantOfKind(index, "SemanticIndexWithClause") ?? index;
        context.add(
            "MissingSemanticIndexOption",
            "Missing EXTERNAL_MODEL in the CREATE SEMANTIC INDEX statement.",
            withClause,
        );
    }
}

function validateIndexCatalog(context: IndexDiagnosticContext): void {
    for (const index of context.nodes("CreateIndexStatement")) {
        if (containsSyntaxError(index)) continue;
        const targetNode = firstDescendantOfKind(index, "MultipartIdentifier");
        const nameNode = firstDescendantOfKind(index, "IdentifierName");
        if (!targetNode || !nameNode) continue;
        const targetName = compactMultipartName(context.source(targetNode));
        const parts = multipartIdentifierParts(targetName);
        if (context.localRelationKnownAt(parts, targetNode.start)) continue;
        const resolution = context.metadata.resolveObject(parts);
        if (resolution.kind !== "resolved") continue;
        const object = resolution.object;
        const indexName = normalizeIdentifier(context.source(nameNode));
        const { unique, clustered } = indexKindFlags(context, index);
        const isView = object.kind === "view";

        if (isView && clustered && !unique) {
            context.add(
                "CannotCreateNonuniqueClusteredIndexOnView",
                `Cannot create nonunique clustered index on view '${targetName}' because only unique clustered indexes are allowed. Consider creating unique clustered index instead.`,
                nameNode,
            );
        }

        const state = context.metadata.indexState(object.ref);
        const existingIndexes = state.kind === "loaded" ? state.value : undefined;
        const replaced = existingIndexes?.find((candidate) =>
            context.equal(candidate.name, indexName),
        );
        const dropExisting = hasDropExistingIndexOption(context, index);
        let replaces = false;
        if (existingIndexes && !dropExisting) {
            if (replaced) {
                context.add(
                    "IndexOrStatisticsExists",
                    `The index or statistics with name '${indexName}' already exists on table or view '${targetName}'.`,
                    nameNode,
                );
            } else {
                replaces = true;
            }
        } else if (existingIndexes) {
            if (!replaced) {
                context.add(
                    "CouldNotFindIndex",
                    `Could not find any index named '${indexName}' for table '${targetName}'.`,
                    nameNode,
                );
            } else if (replaced.kind !== "relational") {
                context.add(
                    "CannotConvertXmlOrSpatialIndexToRelational",
                    `Could not convert the XML or spatial index '${indexName}' to a relational index by using the DROP_EXISTING option.  Drop the XML or spatial index and create a relational index with the same name.`,
                    nameNode,
                );
            } else if (replaced.clustered && !clustered) {
                context.add(
                    "CannotConvertClusteredIndexToNonclustered",
                    "Cannot convert a clustered index to a nonclustered index by using the DROP_EXISTING option. To change the index type from clustered to nonclustered, delete the clustered index, and then create a nonclustered index by using two separate statements.",
                    nameNode,
                );
            } else {
                replaces = true;
            }
        }

        validateIndexOrderColumns(context, index, object, clustered);

        if (
            indexRequiresOfflineBuild(context, index, object) &&
            indexRequestsOnline(context, index)
        ) {
            context.add(
                "OnlineOperationCannotBePerformedOnIndexInvalidColumns",
                `An online operation cannot be performed for index '${indexName}' because the index contains columns of data type text, ntext, image, varchar(max), nvarchar(max), varbinary(max), xml, or large CLR type.`,
                nameNode,
            );
        }

        const otherClustered = existingIndexes?.find(
            (candidate) => candidate !== replaced && candidate.clustered === true,
        );
        if (replaces && clustered && otherClustered) {
            context.add(
                "ClusteredIndexExists",
                `Cannot create more than one clustered index on view '${targetName}'. Drop the existing clustered index '${otherClustered.name}' before creating another.`,
                nameNode,
            );
        }

        if (!isView) continue;
        if (object.schemaBound === false) {
            context.add(
                "CannotCreateIndexOnViewNotSchemaBound",
                `Cannot create index on view '${targetName}' because the view is not schema bound.`,
                targetNode,
            );
        }
        const columnState = context.metadata.columnState(object.ref);
        if (
            columnState.kind === "loaded" &&
            columnState.value.some((column) => indexedViewInvalidColumnType(column.typeDisplay))
        ) {
            context.add(
                "CannotCreateIndexOnViewContainsInvalidColumns",
                `Cannot create index on view '${targetName}'. It contains text, ntext, image, FILESTREAM or xml columns.`,
                targetNode,
            );
        }
        if (replaces && !clustered && !otherClustered) {
            context.add(
                "CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex",
                `Cannot create index on view '${targetName}'. It does not have a unique clustered index.`,
                nameNode,
            );
        }
    }
}

function validateIndexOrderColumns(
    context: IndexDiagnosticContext,
    index: SyntaxNode,
    object: ObjectMetadata,
    clustered: boolean,
): void {
    const order = firstDescendantOfKind(index, "IndexOrderClause");
    if (!order) return;
    const targetColumns = context.metadata.columnState(object.ref);
    const indexColumns = new Set(
        indexStoredColumns(context, index).map((column) => context.fold(column)),
    );
    const seen = new Set<string>();
    for (const column of descendantsOfKind(order, "IndexOrderColumn")) {
        const nameNode = firstDescendantOfKind(column, "IdentifierName");
        if (!nameNode) continue;
        const name = normalizeIdentifier(context.source(nameNode));
        const key = context.fold(name);
        if (
            targetColumns.kind === "loaded" &&
            !targetColumns.value.some((candidate) => context.equal(candidate.name, name))
        ) {
            context.add(
                "ColumnNameNotInTargetTable",
                `Column name '${name}' does not exist in the target table or view.`,
                nameNode,
            );
            continue;
        }
        if (seen.has(key)) {
            context.add(
                "DuplicateColumnNamesInIndex",
                `Cannot use duplicate column names in index. Column name '${name}' listed more than once.`,
                nameNode,
            );
            continue;
        }
        seen.add(key);
        if (!clustered && !indexColumns.has(key)) {
            context.add(
                "ColumnIsInvalidForUseAsOrderColumnInIndex",
                `Column '${name}' in table '${object.name}' is of a type that is invalid for use as an order column in an index.`,
                nameNode,
            );
        }
    }
}

function indexStoredColumns(context: IndexDiagnosticContext, index: SyntaxNode): string[] {
    const keyList = firstDescendantOfKind(index, "IndexColumnList");
    const include = firstDescendantOfKind(index, "IncludeClause");
    const names = keyList
        ? descendantsOfKind(keyList, "IndexColumn").flatMap((column) => {
              const name = firstDescendantOfKind(column, "IdentifierName");
              return name ? [normalizeIdentifier(context.source(name))] : [];
          })
        : [];
    if (include) {
        for (const name of descendantsOfKind(include, "IdentifierName")) {
            names.push(normalizeIdentifier(context.source(name)));
        }
    }
    return names;
}

function indexKindFlags(
    context: IndexDiagnosticContext,
    index: SyntaxNode,
): { unique: boolean; clustered: boolean } {
    const kind = firstDescendantOfKind(index, "CreateIndexKind");
    const words = kind
        ? context.significantTokens(kind, 4).map((token) => token.text.toUpperCase())
        : [];
    return { unique: words.includes("UNIQUE"), clustered: words.includes("CLUSTERED") };
}

function indexRequiresOfflineBuild(
    context: IndexDiagnosticContext,
    index: SyntaxNode,
    object: ObjectMetadata,
): boolean {
    const include = firstDescendantOfKind(index, "IncludeClause");
    if (!include) return false;
    const columnState = context.metadata.columnState(object.ref);
    if (columnState.kind !== "loaded") return false;
    return descendantsOfKind(include, "IdentifierName").some((node) => {
        const name = normalizeIdentifier(context.source(node));
        const column = columnState.value.find((candidate) => context.equal(candidate.name, name));
        return offlineOnlyIncludedColumnType(column?.typeDisplay);
    });
}

function indexRequestsOnline(context: IndexDiagnosticContext, index: SyntaxNode): boolean {
    return descendantsOfKind(index, "GenericOption").some((option) => {
        const name = firstDescendantOfKind(option, "GenericOptionName");
        if (!name || normalizeIdentifier(context.source(name).trim()).toUpperCase() !== "ONLINE") {
            return false;
        }
        const value = firstDescendantOfKind(option, "OptionValue");
        return value !== undefined && context.source(value).toUpperCase() === "ON";
    });
}

function indexedViewInvalidColumnType(typeDisplay: string | undefined): boolean {
    return (
        typeDisplay !== undefined && !indexColumnTypeFacts(typeDisplay).validIndexedViewProjection
    );
}

function offlineOnlyIncludedColumnType(typeDisplay: string | undefined): boolean {
    return typeDisplay !== undefined && indexColumnTypeFacts(typeDisplay).requiresOfflineBuild;
}
