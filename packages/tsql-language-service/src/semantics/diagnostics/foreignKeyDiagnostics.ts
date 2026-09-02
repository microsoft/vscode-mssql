/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView, ObjectMetadata } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import {
    descendantsOfKind,
    directChildrenOfKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import {
    compactMultipartName,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import { parseDataTypeText, recoveredConstraintName } from "./diagnosticTextFacts.js";

export interface ForeignKeyDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    readonly syntax: SyntaxSnapshot;
    fold(value: string): string;
    equal(left: string, right: string): boolean;
    definitionColumns(root: SyntaxNode): readonly ColumnMetadata[];
    sameObjectName(left: readonly string[], right: readonly string[]): boolean;
    localRelationAt(
        parts: readonly string[],
        offset: number,
    ): { readonly create: boolean; readonly columns?: readonly ColumnMetadata[] } | undefined;
    loadedColumns(object: ObjectMetadata): readonly ColumnMetadata[] | undefined;
    isKnownSystemDataType(parts: readonly string[], name: string, source: string): boolean;
}

/** Validates foreign-key targets, candidate keys, column counts, and compatible base types. */
export function validateForeignKeys(context: ForeignKeyDiagnosticContext): void {
    for (const reference of context.nodes("ReferencesClause")) {
        const definition = parentOfKind(reference, "TableDefinition");
        const create = definition && parentOfKind(definition, "CreateTableStatement");
        const ownerNameNode = create && firstDescendantOfKind(create, "MultipartIdentifier");
        const referencedNameNode = firstDescendantOfKind(reference, "MultipartIdentifier");
        if (!definition || !ownerNameNode || !referencedNameNode) continue;

        const ownerName = compactMultipartName(context.source(ownerNameNode));
        const ownerParts = multipartIdentifierParts(ownerName);
        const ownerDisplay = ownerParts.at(-1) ?? ownerName;
        const tableConstraint = parentOfKind(reference, "TableConstraint");
        const constraintBody =
            tableConstraint && firstDescendantOfKind(tableConstraint, "TableConstraintBody");
        if (
            tableConstraint &&
            constraintBody &&
            directChildrenOfKind(constraintBody, "ColumnNameList").length === 0
        ) {
            context.add(
                "TableConstraintHasNoColumnList",
                `Table level constraint does not specify column list, table '${ownerDisplay}'.`,
                tableConstraint,
            );
            continue;
        }
        const constraintName = foreignKeyConstraintName(
            context,
            tableConstraint ?? parentOfKind(reference, "ColumnConstraint"),
        );
        const localColumns = context.definitionColumns(definition);
        const referencingNodes = foreignKeyReferencingColumns(reference);
        const referencingColumns = referencingNodes.map((node) => ({
            node,
            name: normalizeIdentifier(context.source(node)),
            column: localColumns.find((column) =>
                context.equal(column.name, normalizeIdentifier(context.source(node))),
            ),
        }));
        for (const entry of referencingColumns) {
            if (entry.column) continue;
            context.add(
                "ForeignKeyInvalidReferencingColumn",
                `Foreign key '${constraintName}' references invalid column '${entry.name}' in referencing table '${ownerDisplay}'.`,
                entry.node,
            );
        }

        const referencedName = compactMultipartName(context.source(referencedNameNode));
        const referencedParts = multipartIdentifierParts(referencedName);
        const selfReference = context.sameObjectName(ownerParts, referencedParts);
        const localEvent = selfReference
            ? undefined
            : context.localRelationAt(referencedParts, reference.start);
        const localReference = selfReference
            ? { columns: localColumns }
            : localEvent?.create
              ? localEvent
              : undefined;
        const resolution =
            localReference || localEvent
                ? undefined
                : context.metadata.resolveObject(referencedParts);
        if (
            !localReference &&
            ((localEvent !== undefined && !localEvent.create) ||
                resolution?.kind === "notFound" ||
                (resolution?.kind === "resolved" && resolution.object.kind !== "table"))
        ) {
            context.add(
                "ForeignKeyReferencesInvalidTable",
                `Foreign key '${constraintName}' references invalid table '${referencedName}'.`,
                referencedNameNode,
            );
            continue;
        }
        let referencedColumns: readonly ColumnMetadata[] | undefined;
        if (localReference) referencedColumns = localReference.columns;
        else if (resolution?.kind === "resolved") {
            referencedColumns = context.loadedColumns(resolution.object);
        } else continue;
        if (!referencedColumns) continue;

        const explicitList = firstDescendantOfKind(reference, "ColumnNameList");
        let referencedEntries: readonly {
            readonly node: SyntaxNode;
            readonly name: string;
            readonly column?: ColumnMetadata;
        }[];
        if (explicitList) {
            referencedEntries = descendantsOfKind(explicitList, "IdentifierName").map((node) => {
                const name = normalizeIdentifier(context.source(node));
                return {
                    node,
                    name,
                    column: referencedColumns.find((column) => context.equal(column.name, name)),
                };
            });
            for (const entry of referencedEntries) {
                if (entry.column) continue;
                context.add(
                    "ForeignKeyInvalidReferencedColumn",
                    `Foreign key '${constraintName}' references invalid column '${entry.name}' in referenced table '${referencedName}'.`,
                    entry.node,
                );
            }
            if (
                !localReference &&
                resolution?.kind === "resolved" &&
                referencedEntries.every((entry) => entry.column) &&
                !referencedKeyExists(
                    context,
                    resolution.object,
                    referencedEntries.map((entry) => entry.name),
                )
            ) {
                context.add(
                    "NoPrimaryKeysInReferencedTable",
                    `There are no primary or candidate keys in the referenced table '${referencedName}' that match the referencing column list in the foreign key '${constraintName}'.`,
                    referencedNameNode,
                );
            }
        } else {
            const primaryKey = referencedColumns
                .filter((column) => column.primaryKeyOrdinal !== undefined)
                .sort((left, right) => left.primaryKeyOrdinal! - right.primaryKeyOrdinal!);
            if (primaryKey.length === 0) {
                context.add(
                    "ForeignKeyReferencesImplicitlyTableWithoutPrimaryKey",
                    `Foreign key '${constraintName}' has implicit reference to object '${referencedName}' which does not have a primary key defined on it.`,
                    referencedNameNode,
                );
                continue;
            }
            referencedEntries = primaryKey.map((column) => ({
                node: referencedNameNode,
                name: column.name,
                column,
            }));
        }

        if (referencingColumns.length !== referencedEntries.length) {
            context.add(
                "ForeignKeyNumberOfRefColumnsDiffers",
                `Number of referencing columns in foreign key differs from number of referenced columns, table '${ownerDisplay}'.`,
                reference,
            );
            continue;
        }
        for (let index = 0; index < referencingColumns.length; index++) {
            const referencing = referencingColumns[index]!;
            const referenced = referencedEntries[index]!;
            if (!referencing.column || !referenced.column) continue;
            const referencingType = foreignKeyBaseType(context, referencing.column.typeDisplay);
            const referencedType = foreignKeyBaseType(context, referenced.column.typeDisplay);
            if (!referencingType || !referencedType || referencingType === referencedType) continue;
            context.add(
                "ColumnIsNotSameTypeAsRefColumn",
                `Column '${referencedName}.${referenced.name}' is not the same data type as referencing column '${ownerDisplay}.${referencing.name}' in foreign key '${constraintName}'.`,
                referencing.node,
            );
        }
    }
}

function foreignKeyConstraintName(
    context: ForeignKeyDiagnosticContext,
    constraint: SyntaxNode | undefined,
): string {
    return constraint ? recoveredConstraintName(context.source(constraint)) : "";
}

function foreignKeyReferencingColumns(reference: SyntaxNode): readonly SyntaxNode[] {
    const tableConstraint = parentOfKind(reference, "TableConstraint");
    if (tableConstraint) {
        const list = descendantsOfKind(tableConstraint, "ColumnNameList").find(
            (candidate) => candidate.end <= reference.start,
        );
        return list ? descendantsOfKind(list, "IdentifierName") : [];
    }
    const column = parentOfKind(reference, "ColumnDefinition");
    const name = column && firstDescendantOfKind(column, "IdentifierName");
    return name ? [name] : [];
}

function foreignKeyBaseType(
    context: ForeignKeyDiagnosticContext,
    typeDisplay: string | undefined,
): string | undefined {
    if (!typeDisplay) return undefined;
    const parsed = parseDataTypeText(typeDisplay);
    if (!parsed) return undefined;
    const aliases: Readonly<Record<string, string>> = {
        dec: "decimal",
        double: "float",
        integer: "int",
        national: "nchar",
        rowversion: "timestamp",
    };
    const name = aliases[parsed.name] ?? parsed.name;
    return context.isKnownSystemDataType([name], name, typeDisplay) ? name : undefined;
}

function referencedKeyExists(
    context: ForeignKeyDiagnosticContext,
    object: ObjectMetadata,
    columns: readonly string[],
): boolean {
    const state = context.metadata.indexState(object.ref);
    if (state.kind !== "loaded") return true;
    const wanted = new Set(columns.map((column) => context.fold(column)));
    if (wanted.size !== columns.length) return true;
    return state.value.some((index) => {
        if (index.unique !== true || !index.columns) return false;
        const keys = index.columns.filter((column) => column.included !== true);
        return (
            keys.length === wanted.size &&
            keys.every((column) => wanted.has(context.fold(column.name)))
        );
    });
}
