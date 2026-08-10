/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCatalogChild,
    SqlCatalogColumn,
    SqlCatalogObject,
    SqlCatalogProvider,
    SqlRoutineParameter,
    SqlSpan,
} from "../analysis/contracts.js";
import type {
    AlterTableNode,
    ColumnDefinition,
    CreateNode,
    DropNode,
    IdentifierNode,
} from "../parser/saral/ast/types.js";
import { walkAST, type AnalysisResult, type ASTNode } from "../parser/saral/index.js";
import {
    DocumentSchemaEvolution,
    normalizeSemanticIdentifier,
    type DocumentSchemaChange,
    type SemanticObject,
    type SemanticObjectKind,
} from "../semantic/index.js";

/** Decorates live metadata with DDL facts visible at one document offset. */
export class DocumentSchemaCatalogProvider implements SqlCatalogProvider {
    public readonly version: string;
    public readonly world: "open" | "closed";

    public constructor(
        private readonly document: DocumentSchemaEvolution,
        private readonly offset: number,
        private readonly fallback?: SqlCatalogProvider,
        documentVersion: string | number = 0,
    ) {
        this.version = `document:${documentVersion}:${offset}|catalog:${fallback?.version ?? "none"}`;
        this.world = fallback?.world ?? "open";
    }

    public columnsFor(parts: readonly string[]): readonly SqlCatalogColumn[] | undefined {
        return this.document.columnsForAt(parts, this.offset) ?? this.fallback?.columnsFor(parts);
    }

    public objectFor(parts: readonly string[]): SqlCatalogObject | undefined {
        const local = this.document.resolveAt(parts, this.offset);
        return local ? mapObject(local) : this.fallback?.objectFor?.(parts);
    }

    public tableCandidates(parts: readonly string[]): readonly (readonly string[])[] {
        return dedupePaths([
            ...this.visibleObjects()
                .filter((object) => suffixMatches(object.parts, parts))
                .map((object) => object.parts),
            ...(this.fallback?.tableCandidates?.(parts) ?? []),
        ]);
    }

    public childrenOf(prefixParts: readonly string[]): readonly SqlCatalogChild[] {
        const children: SqlCatalogChild[] = [
            ...localChildren(this.visibleObjects(), prefixParts),
            ...(this.fallback?.childrenOf?.(prefixParts) ?? []),
        ];
        const seen = new Set<string>();
        return children.filter((child) => {
            const key = `${child.kind}:${normalizeSemanticIdentifier(child.name)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    public tables(): readonly string[] {
        return [
            ...new Set([
                ...this.visibleObjects()
                    .filter(isRelation)
                    .map((object) => object.parts.join(".")),
                ...(this.fallback?.tables?.() ?? []),
            ]),
        ];
    }

    public definitionSpanFor(
        parts: readonly string[],
        kind?: SemanticObjectKind,
    ): SqlSpan | undefined {
        return this.document.definitionSpanAt(parts, this.offset, kind);
    }

    private visibleObjects(): readonly SemanticObject[] {
        return this.document.objects.filter(
            (object) =>
                this.document.resolveAt(object.parts, this.offset, object.kind)?.identity.key ===
                object.identity.key,
        );
    }
}

/** Normalizes current parser AST DDL into the ordered document schema model without reparsing. */
export function createDocumentSchemaEvolution(
    analysis: AnalysisResult,
    uri?: string,
): DocumentSchemaEvolution {
    const changes: DocumentSchemaChange[] = [];
    const batchSeparators = analysis.ast.body
        .filter((statement) => statement.type === "BatchSeparatorStatement")
        .map((statement) => statement.start);
    const databaseChanges = analysis.ast.body
        .filter((statement) => statement.type === "UseStatement")
        .map((statement) => ({
            offset: statement.start,
            parts: expressionIdentifierParts(statement.database),
        }))
        .filter(
            (change): change is { readonly offset: number; readonly parts: readonly string[] } =>
                change.parts.length > 0,
        );
    let moduleDepth = 0;
    walkAST(analysis.ast, {
        enter(node) {
            const batch = countBefore(batchSeparators, node.start);
            const database = databaseChanges.findLast(
                (change) => change.offset < node.start,
            )?.parts;
            const insideStoredModule = moduleDepth > 0;
            if (isStoredModule(node)) {
                moduleDepth++;
            }
            if (insideStoredModule) {
                return;
            }
            switch (node.type) {
                case "CreateStatement":
                    changes.push(withDatabase(createChange(node as CreateNode, batch), database));
                    break;
                case "AlterTableStatement": {
                    const change = alterTableChange(node as AlterTableNode, batch);
                    if (change) changes.push(withDatabase(change, database));
                    break;
                }
                case "DropStatement":
                    changes.push(
                        ...dropChanges(node as DropNode, batch).map((change) =>
                            withDatabase(change, database),
                        ),
                    );
                    break;
            }
        },
        exit(node) {
            if (isStoredModule(node)) {
                moduleDepth--;
            }
        },
    });
    return new DocumentSchemaEvolution(changes, { uri });
}

function isStoredModule(node: ASTNode): node is CreateNode {
    if (node.type !== "CreateStatement") return false;
    const create = node as CreateNode;
    return create.objectType === "PROCEDURE" || create.objectType === "FUNCTION";
}

function countBefore(sortedOffsets: readonly number[], offset: number): number {
    let low = 0;
    let high = sortedOffsets.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((sortedOffsets[middle] ?? Number.POSITIVE_INFINITY) < offset) low = middle + 1;
        else high = middle;
    }
    return low;
}

function expressionIdentifierParts(expression: ASTNode | null): readonly string[] {
    if (!expression || !("parts" in expression) || !Array.isArray(expression.parts)) {
        return [];
    }
    return expression.parts.map(String).map(unquoteIdentifier);
}

function withDatabase(
    change: DocumentSchemaChange,
    database: readonly string[] | undefined,
): DocumentSchemaChange {
    if (!database?.length || change.nameParts.length >= 3 || change.nameParts[0]?.startsWith("#")) {
        return change;
    }
    const nameParts =
        change.nameParts.length === 1
            ? [...database, "dbo", ...change.nameParts]
            : [...database, ...change.nameParts];
    return { ...change, nameParts };
}

function createChange(statement: CreateNode, batch: number): DocumentSchemaChange {
    const kind = createKind(statement);
    const columns =
        kind === "tableFunction"
            ? mapColumns(statement.returnColumns ?? [])
            : mapColumns(statement.columns ?? []);
    return {
        operation: "replace",
        kind,
        nameParts: identifierParts(statement.nameNode),
        span: { start: statement.start, end: statement.end },
        batch,
        columns,
        parameters: (statement.parameters ?? []).map((parameter) => ({
            name: parameter.name,
            type: parameter.dataType,
            direction: parameter.isOutput ? ("inputOutput" as const) : ("input" as const),
            optional: parameter.defaultValue !== undefined && parameter.defaultValue !== null,
            span: { start: parameter.start, end: parameter.start + parameter.name.length },
        })),
        // Saral's returnVariable is the name of the table variable used by a
        // multi-statement TVF, not the scalar function's SQL return type. Keep
        // this unknown until the parser exposes the actual RETURNS type.
        returnType: undefined,
    };
}

function alterTableChange(
    statement: AlterTableNode,
    batch: number,
): DocumentSchemaChange | undefined {
    const action = statement.action;
    if (!action) return undefined;
    switch (action.kind) {
        case "ADD_COLUMN":
            return ddlColumnChange("addColumns", statement, action.column, batch);
        case "ALTER_COLUMN":
            return ddlColumnChange("alterColumns", statement, action.column, batch);
        case "DROP_COLUMN":
            return {
                operation: "dropColumns",
                kind: "table",
                nameParts: identifierParts(statement.table),
                span: { start: statement.start, end: statement.end },
                batch,
                columns: [{ name: action.name }],
            };
        default:
            return undefined;
    }
}

function ddlColumnChange(
    operation: "addColumns" | "alterColumns",
    statement: AlterTableNode,
    column: ColumnDefinition,
    batch: number,
): DocumentSchemaChange {
    return {
        operation,
        kind: "table",
        nameParts: identifierParts(statement.table),
        span: { start: statement.start, end: statement.end },
        batch,
        columns: mapColumns([column]),
    };
}

function dropChanges(statement: DropNode, batch: number): DocumentSchemaChange[] {
    const kind = dropKind(statement.objectType);
    if (!kind) return [];
    return (statement.targets ?? (statement.target ? [statement.target] : [])).map((target) => ({
        operation: "drop" as const,
        kind,
        nameParts: identifierParts(target),
        span: { start: statement.start, end: statement.end },
        batch,
    }));
}

function createKind(statement: CreateNode): SemanticObjectKind {
    switch (statement.objectType) {
        case "VIEW":
            return "view";
        case "PROCEDURE":
            return "procedure";
        case "FUNCTION":
            return statement.returnColumns?.length ? "tableFunction" : "scalarFunction";
        case "TYPE":
            return "type";
        case "SYNONYM":
            return "synonym";
        case "TABLE":
            return "table";
        default:
            return "unknown";
    }
}

function dropKind(value: DropNode["objectType"]): SemanticObjectKind | undefined {
    switch (value) {
        case "TABLE":
            return "table";
        case "VIEW":
            return "view";
        case "PROCEDURE":
            return "procedure";
        case "FUNCTION":
            return "scalarFunction";
        case "TYPE":
            return "type";
        case "SYNONYM":
            return "synonym";
        default:
            return undefined;
    }
}

function mapColumns(columns: readonly ColumnDefinition[]): readonly SqlCatalogColumn[] {
    return columns.map((column) => ({
        name: column.name,
        type: column.dataType,
        nullable: !column.constraints?.some((constraint) => constraint.kind === "NOT NULL"),
    }));
}

function mapObject(object: SemanticObject): SqlCatalogObject {
    return {
        parts: object.parts,
        kind: object.kind,
        columns: object.columns,
        parameters: object.parameters as readonly SqlRoutineParameter[] | undefined,
        returnType: object.returnType,
    };
}

function identifierParts(identifier: IdentifierNode): readonly string[] {
    return identifier.parts.map(unquoteIdentifier);
}

function unquoteIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]"))
        return value.slice(1, -1).replaceAll("]]", "]");
    if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1).replaceAll('""', '"');
    return value;
}

function suffixMatches(parts: readonly string[], suffix: readonly string[]): boolean {
    if (suffix.length > parts.length) return false;
    const offset = parts.length - suffix.length;
    return suffix.every(
        (part, index) =>
            normalizeSemanticIdentifier(part) ===
            normalizeSemanticIdentifier(parts[offset + index] ?? ""),
    );
}

function localChildren(
    objects: readonly SemanticObject[],
    prefix: readonly string[],
): SqlCatalogChild[] {
    const result: SqlCatalogChild[] = [];
    for (const object of objects) {
        const start = findPrefixStart(object.parts, prefix);
        if (start < 0) continue;
        const index = start + prefix.length;
        const name = object.parts[index];
        if (name) {
            result.push({
                name,
                kind: index === object.parts.length - 1 ? "table" : "namespace",
            });
        }
    }
    return result;
}

function findPrefixStart(parts: readonly string[], prefix: readonly string[]): number {
    if (prefix.length === 0) return 0;
    for (let start = 0; start + prefix.length < parts.length; start++) {
        if (
            prefix.every(
                (part, index) =>
                    normalizeSemanticIdentifier(part) ===
                    normalizeSemanticIdentifier(parts[start + index] ?? ""),
            )
        ) {
            return start;
        }
    }
    return -1;
}

function dedupePaths(paths: readonly (readonly string[])[]): readonly (readonly string[])[] {
    const seen = new Set<string>();
    return paths.filter((parts) => {
        const key = parts.map(normalizeSemanticIdentifier).join(".");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isRelation(object: SemanticObject): boolean {
    return ["table", "view", "tableFunction", "synonym"].includes(object.kind);
}
