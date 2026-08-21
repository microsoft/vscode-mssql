/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import {
    descendantsOfKind,
    descendantsOwnedByKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import { normalizeIdentifier } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import {
    columnConstraintCounts,
    columnDefinitionTextFacts,
    isInvalidSparseDataType,
    parseDataTypeText,
} from "./diagnosticTextFacts.js";

export interface TableDefinitionDiagnosticContext extends DiagnosticFamilyContext {
    readonly syntax: SyntaxSnapshot;
    fold(value: string): string;
    equal(left: string, right: string): boolean;
    tableDefinitionOwner(definition: SyntaxNode): string;
}

/** Validates column identity, sparse/temporal options, and table-level period contracts. */
export function validateTableDefinitions(context: TableDefinitionDiagnosticContext): void {
    for (const definition of context.nodes("TableDefinition")) {
        const owner = context.tableDefinitionOwner(definition);
        const seen = new Set<string>();
        let primaryKeyCount = 0;
        const columnSets: SyntaxNode[] = [];
        const rowStarts: NamedNode[] = [];
        const rowEnds: NamedNode[] = [];
        for (const column of descendantsOwnedByKind(definition, "ColumnDefinition", definition)) {
            const nameNode = firstDescendantOfKind(column, "IdentifierName");
            if (!nameNode) continue;
            const name = normalizeIdentifier(context.source(nameNode));
            const source = context.source(column);
            const facts = columnDefinitionTextFacts(source);
            const key = context.fold(name);
            if (seen.has(key)) {
                context.add(
                    "ColumnNameNotUnique",
                    `Column names in each table must be unique. Column name '${name}' in table '${owner}' is specified more than once.`,
                    nameNode,
                );
            }
            seen.add(key);

            primaryKeyCount += facts.primaryKeyCount;
            validateColumnConstraints(context, column, name, owner, source);

            if (facts.columnSet) {
                columnSets.push(column);
                const type = firstDescendantOfKind(column, "DataType");
                const typeText = type ? context.source(type) : "";
                if (parseDataTypeText(typeText)?.name !== "xml" || !facts.nullable) {
                    context.add(
                        "CannotCreateSparseColumnSetOnTable",
                        `Cannot create the sparse column set '${name}' in the table '${owner}' because a sparse column set must be a nullable xml column. Modify the column definition to allow null values.`,
                        column,
                    );
                }
            }

            if (facts.generatedRow) {
                const target = facts.generatedRow === "START" ? rowStarts : rowEnds;
                target.push({ name, node: column });
                const type = firstDescendantOfKind(column, "DataType");
                if (!type || parseDataTypeText(context.source(type))?.name !== "datetime2") {
                    context.add(
                        "CannotCreateGeneratedAlwaysColumnType",
                        `Temporal generated always column '${name}' has invalid data type.`,
                        column,
                    );
                } else if (facts.explicitlyNullable) {
                    context.add(
                        "CannotCreateGeneratedAlwaysColumnNullable",
                        `Period column '${name}' in a system-versioned temporal table cannot be nullable.`,
                        column,
                    );
                }
            }
        }

        primaryKeyCount += descendantsOwnedByKind(definition, "TableConstraint", definition).reduce(
            (count, constraint) =>
                count + columnDefinitionTextFacts(context.source(constraint)).primaryKeyCount,
            0,
        );
        if (primaryKeyCount > 1) {
            context.add(
                "MultiplePrimaryKey",
                `Cannot add multiple PRIMARY KEY constraints to table '${owner}'.`,
                definition,
            );
        }
        if (columnSets.length > 1) {
            const duplicate = columnSets[1]!;
            const name = normalizeIdentifier(
                context.source(firstDescendantOfKind(duplicate, "IdentifierName") ?? duplicate),
            );
            context.add(
                "CannotCreateMoreThanOneColumnSetOnTable",
                `Cannot create the sparse column set '${name}' in the table '${owner}' because a table cannot have more than one sparse column set. Modify the statement so that only one column is specified as COLUMN_SET FOR ALL_SPARSE_COLUMNS.`,
                duplicate,
            );
        }
        if (rowStarts.length > 1) {
            context.add(
                "CannotCreateMoreThanOneGeneratedAlwaysAsRowStartColumnOnTable",
                "Table cannot have more than one 'GENERATED ALWAYS AS ROW START' column.",
                rowStarts[1]!.node,
            );
        }
        if (rowEnds.length > 1) {
            context.add(
                "CannotCreateMoreThanOneGeneratedAlwaysAsRowEndColumnOnTable",
                "Table cannot have more than one 'GENERATED ALWAYS AS ROW END' column.",
                rowEnds[1]!.node,
            );
        }

        const periods = descendantsOwnedByKind(definition, "PeriodDefinition", definition);
        if (periods.length > 1) {
            context.add(
                "CannotCreateMoreThanOneTemporalSystemTimePeriodOnTable",
                "Table cannot have more than one SYSTEM_TIME period definition.",
                periods[1]!,
            );
        }
        const period = periods[0];
        if (period) {
            if (rowStarts.length === 0) {
                context.add(
                    "GeneratedAlwaysAsRowStartColumnDefinitionMissing",
                    "Temporal 'GENERATED ALWAYS AS ROW START' column definition missing.",
                    period,
                );
            } else if (rowEnds.length === 0) {
                context.add(
                    "GeneratedAlwaysAsRowEndColumnDefinitionMissing",
                    "Temporal 'GENERATED ALWAYS AS ROW END' column definition missing.",
                    period,
                );
            } else {
                const periodNames = descendantsOfKind(period, "IdentifierName").map((node) =>
                    normalizeIdentifier(context.source(node)),
                );
                if (periodNames[0] && !context.equal(periodNames[0], rowStarts[0]!.name)) {
                    context.add(
                        "GeneratedAlwaysAsRowStartColumnWrongName",
                        "Table SYSTEM_TIME period definition start column name not matching 'GENERATED ALWAYS AS ROW START' column name.",
                        period,
                    );
                }
                if (periodNames[1] && !context.equal(periodNames[1], rowEnds[0]!.name)) {
                    context.add(
                        "GeneratedAlwaysAsRowEndColumnWrongName",
                        "Table SYSTEM_TIME period definition end column name not matching 'GENERATED ALWAYS AS ROW END' column name.",
                        period,
                    );
                }
            }
        } else if (rowStarts.length > 0 || rowEnds.length > 0) {
            context.add(
                "TemporalSystemTimePeriodDefinitionMissing",
                "Cannot create generated always column when SYSTEM_TIME period is not defined.",
                definition,
            );
        }
    }
}

function validateColumnConstraints(
    context: TableDefinitionDiagnosticContext,
    column: SyntaxNode,
    name: string,
    owner: string,
    source: string,
): void {
    const counts = columnConstraintCounts(source);
    for (const label of ["CHECK", "DEFAULT", "IDENTITY", "PRIMARY KEY", "ROWGUIDCOL", "UNIQUE"]) {
        if ((counts.get(label) ?? 0) <= 1) continue;
        context.add(
            "ColumnConstraintNotUnique",
            `Multiple ${label} constraints were specified for column '${name}', table '${owner}'.`,
            column,
        );
    }
    if ((counts.get("NULL") ?? 0) > 1) {
        context.add(
            "ColumnConstraintNotUnique",
            `Multiple NULL constraints were specified for column '${name}', table '${owner}'.`,
            column,
        );
    }
    const facts = columnDefinitionTextFacts(source);
    if (facts.primaryKeyCount > 0 && facts.hasUnique) {
        context.add(
            "PrimaryKeyNotUnique",
            `Both a PRIMARY KEY and UNIQUE constraint have been defined for column '${name}', table '${owner}'. Only one is allowed.`,
            column,
        );
    }
    if (!facts.hasSparse) return;
    const type = firstDescendantOfKind(column, "DataType");
    const typeText = type ? context.source(type) : "";
    if (facts.invalidSparseOption || isInvalidSparseDataType(typeText)) {
        context.add(
            "CannotCreateSparseColumn",
            `Cannot create the sparse column '${name}' in the table '${owner}' because an option or data type specified is not valid. A sparse column must be nullable and cannot have the ROWGUIDCOL, IDENTITY, or FILESTREAM properties. A sparse column cannot be of the following data types: text, ntext, image, geometry, geography, or user-defined type.`,
            column,
        );
    } else if (facts.hasDefault) {
        context.add(
            "CannotCreateDefaultConstraintOnSparseColumn",
            `A DEFAULT constraint cannot be created on the column '${name}' in the table '${owner}' because the column is a sparse column or sparse column set. Sparse columns or sparse column sets cannot have a DEFAULT constraint.`,
            column,
        );
    } else if (facts.primaryKeyCount > 0 || facts.hasUnique) {
        context.add(
            "ColumnIsInvalidForUseAsKeyColumnInIndex",
            `Column '${name}' in table '${owner}' is of a type that is invalid for use as a key column in an index.`,
            column,
        );
    }
}

interface NamedNode {
    readonly name: string;
    readonly node: SyntaxNode;
}
