/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView } from "../../metadata/index.js";
import type { SyntaxNode } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOfKind,
    descendantsOwnedByKind,
    directChildrenOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import { compactMultipartName, multipartIdentifierParts } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const nestedDmlStatementKinds = new Set([
    "DeleteStatement",
    "InsertStatement",
    "MergeStatement",
    "UpdateStatement",
]);

/** Requires the OUTPUT clause that supplies rows for a DML statement used as a table source. */
export function validateNestedDml(context: DiagnosticFamilyContext): void {
    for (const source of context.nodes("NestedDmlTableSource")) {
        if (containsSyntaxError(source)) continue;
        const statement = [...source.children()].find((child) =>
            nestedDmlStatementKinds.has(child.kind),
        );
        if (!statement || firstDescendantOfKind(statement, "OutputClause")) continue;
        context.add(
            "NestedDmlMustHaveOutputClause",
            "A nested INSERT, UPDATE, DELETE, or MERGE statement must have an OUTPUT clause.",
            statement,
        );
    }
}

export interface DmlDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    fold(value: string): string;
    equal(left: string, right: string): boolean;
    relationColumnsAt(
        parts: readonly string[],
        offset: number,
    ): readonly ColumnMetadata[] | undefined;
    localRelationKnownAt(parts: readonly string[], offset: number): boolean;
    functionRedefinedBefore(parts: readonly string[], offset: number): boolean;
    isCteReference(node: SyntaxNode, parts: readonly string[]): boolean;
    tableVariableColumnsAt(name: string, offset: number): readonly ColumnMetadata[] | undefined;
}

/** Validates INSERT and UPDATE shapes against the one pinned semantic/catalog snapshot. */
export function validateDml(context: DmlDiagnosticContext): void {
    for (const insert of context.nodes("InsertStatement")) {
        const target = firstDescendantOfKind(insert, "DmlTarget");
        const nameNode = target && firstDescendantOfKind(target, "MultipartIdentifier");
        if (!target || !nameNode) continue;
        const targetName = compactMultipartName(context.source(nameNode));
        const targetColumns = context.relationColumnsAt(
            multipartIdentifierParts(targetName),
            target.start,
        );
        const insertColumns = descendantsOwnedByKind(target, "ColumnReference", target);
        const seen = new Set<string>();
        for (const column of insertColumns) {
            const name = multipartIdentifierParts(context.source(column)).at(-1);
            if (!name) continue;
            const key = context.fold(name);
            if (seen.has(key)) {
                context.add(
                    "ColumnSpecifiedMultipleTimes",
                    `The column '${name}' was specified multiple times for '${targetName}'.`,
                    column,
                );
            }
            seen.add(key);
            if (targetColumns && !hasColumn(context, targetColumns, name)) {
                context.add(
                    "ColumnNameNotInTargetTable",
                    `Column name '${name}' does not exist in the target table or view.`,
                    column,
                );
            }
        }

        const rows = descendantsOwnedByKind(insert, "RowValue", insert);
        const rowCounts = rows.map((row) => directChildrenOfKind(row, "Expression").length);
        if (new Set(rowCounts).size > 1) {
            context.add(
                "NumberOfColumnsMustBeTheSame",
                "The number of columns for each row in a table value constructor must be the same.",
                rows.find((_, index) => index > 0 && rowCounts[index] !== rowCounts[0]) ?? insert,
            );
        }
        const expected =
            insertColumns.length > 0
                ? insertColumns.length
                : targetColumns?.filter((column) => !column.computed && !column.identity).length;
        if (expected !== undefined && rowCounts.some((count) => count !== expected)) {
            context.add(
                "NumberOfValuesDoesNotMatchTableDef",
                "Column name or number of supplied values does not match table definition.",
                rows.find((_, index) => rowCounts[index] !== expected) ?? insert,
            );
        }

        const sourceSelect = firstDescendantOfKind(
            firstDescendantOfKind(insert, "InsertSource") ?? insert,
            "SelectList",
        );
        if (sourceSelect && insertColumns.length > 0) {
            const selected = descendantsOwnedByKind(
                sourceSelect,
                "SelectElement",
                sourceSelect,
            ).length;
            if (selected < insertColumns.length) {
                context.add(
                    "SelectListOfInsertHasFewerItems",
                    "The select list for the INSERT statement contains fewer items than the insert list. The number of SELECT values must match the number of INSERT columns.",
                    sourceSelect,
                );
            } else if (selected > insertColumns.length) {
                context.add(
                    "SelectListOfInsertHasMoreItems",
                    "The select list for the INSERT statement contains more items than the insert list. The number of SELECT values must match the number of INSERT columns.",
                    sourceSelect,
                );
            }
        }
    }

    for (const update of context.nodes("UpdateStatement")) {
        const target = firstDescendantOfKind(update, "DmlTarget");
        const nameNode = target && firstDescendantOfKind(target, "MultipartIdentifier");
        const targetColumns = nameNode
            ? context.relationColumnsAt(
                  multipartIdentifierParts(context.source(nameNode)),
                  nameNode.start,
              )
            : undefined;
        const seen = new Set<string>();
        for (const clause of descendantsOwnedByKind(update, "SetClause", update)) {
            const columnNode = firstDescendantOfKind(clause, "MultipartIdentifier");
            const name = columnNode && multipartIdentifierParts(context.source(columnNode)).at(-1);
            if (!columnNode || !name) continue;
            const key = context.fold(name);
            if (seen.has(key)) {
                context.add(
                    "SetClauseColumnSpecifiedMultipleTimes",
                    `The column name '${name}' is specified more than once in the SET clause. A column cannot be assigned more than one value in the same SET clause. Modify the SET clause to make sure that a column is updated only once. If the SET clause updates columns of a view, then the column name '${name}' may appear twice in the view definition.`,
                    columnNode,
                );
            }
            seen.add(key);
            if (targetColumns && !hasColumn(context, targetColumns, name)) {
                context.add(
                    "ColumnNameNotInTargetTable",
                    `Column name '${name}' does not exist in the target table or view.`,
                    columnNode,
                );
            }
        }
    }
}

/** Validates OUTPUT expressions and OUTPUT INTO targets. */
export function validateOutputClauses(context: DmlDiagnosticContext): void {
    for (const output of context.nodes("OutputClause")) {
        for (const call of descendantsOwnedByKind(output, "FunctionCall", output)) {
            const nameNode = firstDescendantOfKind(call, "MultipartIdentifier");
            if (!nameNode) continue;
            const displayName = compactMultipartName(context.source(nameNode));
            const parts = multipartIdentifierParts(displayName);
            if (parts.length < 2) continue;
            if (context.localRelationKnownAt(parts, nameNode.start)) continue;
            if (context.functionRedefinedBefore(parts, nameNode.start)) continue;
            const resolution = context.metadata.resolveObject(parts);
            if (
                resolution.kind !== "resolved" ||
                resolution.object.kind !== "scalarFunction" ||
                resolution.object.schemaBound !== false
            ) {
                continue;
            }
            context.add(
                "FunctionNotAllowedInOutput",
                `Function '${displayName}' is not allowed in the OUTPUT clause, because it performs user or system data access, or is assumed to perform this access. A function is assumed by default to perform data access if it is not schemabound.`,
                nameNode,
            );
        }
        for (const element of descendantsOwnedByKind(output, "OutputElement", output)) {
            const expression = firstDescendantOfKind(element, "Expression");
            if (!expression) continue;
            const subquery = firstDescendantOfKind(expression, "ParenthesizedQuery");
            if (subquery) {
                context.add(
                    "SubqueriesNotAllowedInOutput",
                    "Subqueries are not allowed in the OUTPUT clause.",
                    subquery,
                );
                continue;
            }
            for (const call of descendantsOfKind(expression, "FunctionCall")) {
                const nameNode = firstDescendantOfKind(call, "MultipartIdentifier");
                const name = nameNode
                    ? multipartIdentifierParts(context.source(nameNode)).at(-1)
                    : undefined;
                if (!name || !aggregateFunctionNames.has(name.toUpperCase())) continue;
                context.add(
                    "AggregateNotAllowedInOutput",
                    "An aggregate may not appear in the OUTPUT clause.",
                    call,
                );
            }
        }

        const into = firstDescendantOfKind(output, "OutputIntoClause");
        const target = into && firstDescendantOfKind(into, "DmlTarget");
        if (!into || !target) continue;
        const targetNameNode = firstDescendantOfKind(target, "MultipartIdentifier");
        if (targetNameNode) {
            const targetName = compactMultipartName(context.source(targetNameNode));
            const parts = multipartIdentifierParts(targetName);
            const resolution = context.metadata.resolveObject(parts);
            if (
                context.isCteReference(targetNameNode, parts) ||
                (resolution.kind === "resolved" && resolution.object.kind === "view")
            ) {
                context.add(
                    "OutputIntoTargetCannotBeViewOrCte",
                    `The target '${targetName}' of the OUTPUT INTO clause cannot be a view or common table expression.`,
                    targetNameNode,
                );
            }

            if (resolution.kind === "resolved") {
                const state = context.metadata.columnState(resolution.object.ref);
                const columns = state.kind === "loaded" ? state.value : undefined;
                const outputCount = descendantsOwnedByKind(output, "OutputElement", output).length;
                const hasColumnList = firstDescendantOfKind(into, "InsertColumnList") !== undefined;
                if (
                    !hasColumnList &&
                    columns?.some((column) => column.identity) &&
                    outputCount > columns.filter((column) => !column.identity).length
                ) {
                    context.add(
                        "ExplicitValueForIdentityColumn",
                        `An explicit value for the identity column in table '${targetName}' can only be specified when a column list is used and IDENTITY_INSERT is ON.`,
                        targetNameNode,
                    );
                }
            }
        }

        const variable = firstDescendantOfKind(target, "Variable");
        const columns = variable
            ? context.tableVariableColumnsAt(context.source(variable), variable.start)
            : undefined;
        if (!variable || !columns) continue;
        const supplied = [
            ...descendantsOfKind(into, "InsertColumn"),
            ...descendantsOfKind(into, "ColumnReference"),
        ];
        for (const columnNode of supplied) {
            const name = multipartIdentifierParts(context.source(columnNode)).at(-1);
            if (!name) continue;
            const column = columns.find((candidate) => context.equal(candidate.name, name));
            if (column?.identity) {
                context.add(
                    "InsertIntoIdentityColumnNotAllowed",
                    "INSERT into an identity column not allowed on table variables.",
                    columnNode,
                );
            }
        }
    }
}

function hasColumn(
    context: DmlDiagnosticContext,
    columns: readonly ColumnMetadata[],
    name: string,
): boolean {
    return columns.some((column) => context.equal(column.name, name));
}

const aggregateFunctionNames = new Set([
    "APPROX_COUNT_DISTINCT",
    "AVG",
    "CHECKSUM_AGG",
    "COUNT",
    "COUNT_BIG",
    "GROUPING",
    "GROUPING_ID",
    "MAX",
    "MIN",
    "STDEV",
    "STDEVP",
    "STRING_AGG",
    "SUM",
    "VAR",
    "VARP",
]);
