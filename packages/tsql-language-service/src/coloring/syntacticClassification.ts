/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier } from "../semantics/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";
import {
    builtInRoutineNames,
    indexOwnerStatements,
    objectNameStatements,
} from "./classificationTables.js";
import { classification, rangeKey, type Classification } from "./classificationModel.js";
import type { SqlColorTokenModifier, SqlColorTokenType } from "./contracts.js";

/** Syntactic roles derived from the concrete syntax tree, before any symbol is bound. */
export interface SyntacticClassification {
    /** Classification for every identifier-shaped token, keyed by its exact document range. */
    readonly roles: ReadonlyMap<string, Classification>;
    /** Name-node range to the range of the part that carries the object identity. */
    readonly lastParts: ReadonlyMap<string, TextRange>;
    /** Every identifier part range in visit order, used to place bound references. */
    readonly parts: readonly TextRange[];
}

/** Ladder walked right to left across the qualifiers of an object name. */
const objectQualifiers: readonly SqlColorTokenType[] = ["schema", "database", "server"];

/** A column adds the rowset that exposes it before the shared object qualifiers. */
const columnQualifiers: readonly SqlColorTokenType[] = ["table", "schema", "database", "server"];

const nameKinds = new Set([
    "MultipartIdentifier",
    "OmittedTableSourceName",
    "TableSourceName",
    "SecurableName",
    "DataTypeName",
    "IdentifierName",
]);

/**
 * Assigns a syntactic role to each identifier token that intersects `range`. Roles come only from
 * tree shape, so damaged input degrades to the plain `identifier` role instead of inventing one.
 */
export function collectSyntacticClassification(
    syntax: SyntaxSnapshot,
    range: TextRange,
): SyntacticClassification {
    const collector = new SyntacticCollector(syntax.document.text);
    collector.visit(syntax.root(), range);
    return collector.result();
}

class SyntacticCollector {
    private readonly _roles = new Map<string, Classification>();
    private readonly _lastParts = new Map<string, TextRange>();
    private readonly _parts: TextRange[] = [];

    public constructor(private readonly _text: string) {}

    public visit(node: SyntaxNode, range: TextRange): void {
        if (node.end < range.start || node.start > range.end) return;
        this.classify(node);
        for (const child of node.children()) this.visit(child, range);
    }

    public result(): SyntacticClassification {
        this._parts.sort((left, right) => left.start - right.start || left.end - right.end);
        return { roles: this._roles, lastParts: this._lastParts, parts: this._parts };
    }

    private classify(node: SyntaxNode): void {
        const statement = objectNameStatements.get(node.kind);
        if (statement) {
            const modifiers: SqlColorTokenModifier[] = [];
            if (statement.declaration) modifiers.push("declaration");
            if (statement.definition) modifiers.push("definition");
            for (const name of directNames(node))
                this.assignObject(name, statement.type, modifiers);
            return;
        }
        if (indexOwnerStatements.has(node.kind)) {
            for (const name of directNames(node)) {
                if (name.kind === "IdentifierName")
                    this.setRole(name, "identifier", ["declaration"]);
                else this.assignObject(name, "table", []);
            }
            return;
        }

        switch (node.kind) {
            case "TableSourceName": {
                const parent = node.parent()?.kind;
                const routine =
                    parent === "FunctionTableSource" || parent === "GlobalFunctionTableSource";
                if (routine) this.assignRoutine(node);
                else this.assignObject(node, "table", []);
                return;
            }
            case "DmlTarget":
            case "IntoClause":
            case "TriggerTarget":
            case "DropTriggerScope":
                for (const name of directNames(node)) this.assignObject(name, "table", []);
                return;
            case "ExecutableEntity": {
                const name = directNames(node)[0];
                if (name) this.assignObject(name, "procedure", []);
                return;
            }
            case "FunctionCall":
            case "FunctionTableSource":
            case "GlobalFunctionTableSource": {
                const name = directNames(node)[0];
                if (name) this.assignRoutine(name);
                return;
            }
            case "FunctionMemberCall": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "function", []);
                return;
            }
            case "DataTypeName":
                this.assignObject(node, "type", []);
                return;
            case "ColumnReference":
            case "InsertColumn":
                this.assignColumn(node, []);
                return;
            case "SetClause": {
                // The assigned name is the first child; a leading variable assignment instead
                // reads any following name, so only the leading form is a column write.
                const first = firstChild(node);
                if (first && nameKinds.has(first.kind)) this.assignColumn(first, ["write"]);
                return;
            }
            case "StarExpression":
                this.assignQualifiers(nameParts(node), columnQualifiers);
                return;
            case "TableAlias": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "alias", ["declaration"]);
                return;
            }
            case "SelectElement":
            case "OutputElement": {
                const alias = directNames(node)[0];
                if (alias?.kind === "IdentifierName") this.setRole(alias, "alias", ["declaration"]);
                return;
            }
            case "ColumnNameList":
                for (const name of directNames(node)) this.setRole(name, "column", ["declaration"]);
                return;
            case "ColumnDefinition":
            case "ColumnSchemaElement": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "column", ["declaration"]);
                return;
            }
            case "IndexColumn": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "column", []);
                return;
            }
            case "CommonTableExpression": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "commonTableExpression", ["declaration"]);
                return;
            }
            case "ProcedureParameter": {
                const variable = firstOfKind(node, "Variable");
                if (variable) this.setRole(variable, "parameter", ["declaration"]);
                return;
            }
            case "VariableDeclaration": {
                const variable = firstOfKind(node, "Variable");
                if (variable) this.setRole(variable, "variable", ["declaration"]);
                return;
            }
            case "CursorDeclaration": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "variable", ["declaration"]);
                return;
            }
            case "CursorLifecycleStatement": {
                // OPEN, FETCH, CLOSE, and DEALLOCATE name a cursor declared as a local.
                const name = directNames(node)[0];
                if (name) this.setRole(name, "variable", []);
                return;
            }
            case "PermissionTarget": {
                const name = directNames(node)[0];
                if (name) this.assignObject(name, securableType(node, this._text), []);
                return;
            }
            case "UseStatement": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "database", []);
                return;
            }
            case "GotoStatement": {
                const name = directNames(node)[0];
                if (name) this.setRole(name, "label", []);
                return;
            }
            case "MultipartIdentifier":
            case "OmittedTableSourceName":
                this.assignGeneric(node);
                return;
            case "IdentifierName":
                this.setRole(node, "identifier", []);
                return;
            case "Variable":
                this.setRole(node, "variable", []);
                return;
            case "GlobalVariable":
                this.setRole(node, "variable", ["system", "readonly"]);
                return;
            case "Label":
                this.setRole(node, "label", ["declaration"]);
                return;
            default:
                return;
        }
    }

    /** Classifies a possibly multipart object name: identity on the last part, then qualifiers. */
    private assignObject(
        name: SyntaxNode,
        type: SqlColorTokenType,
        modifiers: readonly SqlColorTokenModifier[],
    ): void {
        const parts = nameParts(name);
        const last = parts.at(-1);
        if (!last) return;
        this.recordName(name, last);
        const qualifiers = parts.slice(0, -1);
        const system = qualifiers.some(
            (part) => normalizeIdentifier(this.textOf(part)).toLowerCase() === "sys",
        );
        const resolved =
            type === "table" && this.textOf(last).startsWith("#") ? "temporaryTable" : type;
        this.setRole(last, resolved, system ? [...modifiers, "system"] : modifiers);
        this.assignQualifiers(qualifiers, objectQualifiers);
    }

    /** A routine name that resolves to no catalog object may still be a shipped built-in. */
    private assignRoutine(name: SyntaxNode): void {
        const parts = nameParts(name);
        const last = parts.at(-1);
        if (!last) return;
        const builtIn =
            parts.length === 1 &&
            builtInRoutineNames.has(normalizeIdentifier(this.textOf(last)).toLowerCase());
        this.assignObject(name, "function", builtIn ? ["defaultLibrary"] : []);
    }

    private assignColumn(name: SyntaxNode, modifiers: readonly SqlColorTokenModifier[]): void {
        const parts = nameParts(name);
        const last = parts.at(-1);
        if (!last) return;
        this.recordName(name, last);
        this.setRole(last, "column", modifiers);
        this.assignQualifiers(parts.slice(0, -1), columnQualifiers);
    }

    private assignGeneric(name: SyntaxNode): void {
        const parts = nameParts(name);
        const last = parts.at(-1);
        if (!last) return;
        this.recordName(name, last);
        this.setRole(last, "identifier", []);
        this.assignQualifiers(parts.slice(0, -1), objectQualifiers);
    }

    /** Walks qualifiers right to left, holding the outermost role for names beyond the ladder. */
    private assignQualifiers(
        qualifiers: readonly SyntaxNode[],
        ladder: readonly SqlColorTokenType[],
    ): void {
        for (let index = qualifiers.length - 1, step = 0; index >= 0; index--, step++) {
            this.setRole(qualifiers[index]!, ladder[Math.min(step, ladder.length - 1)]!, []);
        }
    }

    private setRole(
        node: SyntaxNode,
        type: SqlColorTokenType,
        modifiers: readonly SqlColorTokenModifier[],
    ): void {
        const key = rangeKey(node);
        // The outermost construct that understands a name wins; descendants only fill gaps.
        if (this._roles.has(key)) return;
        this._roles.set(key, classification(type, modifiers));
        this.recordPart(node);
    }

    private recordPart(node: SyntaxNode): void {
        this._parts.push({ start: node.start, end: node.end });
    }

    private recordName(name: SyntaxNode, last: SyntaxNode): void {
        const key = rangeKey(name);
        if (!this._lastParts.has(key)) {
            this._lastParts.set(key, { start: last.start, end: last.end });
        }
    }

    private textOf(node: SyntaxNode): string {
        return this._text.slice(node.start, node.end);
    }
}

/** Direct name children of a node, keeping source order. */
/**
 * The class of a granted securable, taken from the `SCHEMA::` style qualifier when the statement
 * carries one. Without a qualifier SQL Server resolves the name as an object, which is what an
 * unqualified `GRANT SELECT ON dbo.Orders` means.
 */
function securableType(node: SyntaxNode, text: string): SqlColorTokenType {
    for (const child of node.children()) {
        if (child.kind !== "SecurableClass") continue;
        const declared = normalizeIdentifier(text.slice(child.start, child.end))
            .trim()
            .toLowerCase();
        if (declared === "schema") return "schema";
        if (declared === "database") return "database";
        if (declared === "type") return "type";
        return "identifier";
    }
    return "table";
}

function directNames(node: SyntaxNode): readonly SyntaxNode[] {
    const names: SyntaxNode[] = [];
    for (const child of node.children()) {
        if (nameKinds.has(child.kind)) names.push(child);
    }
    return names;
}

/** The ordered identifier parts of a name, flattening the wrappers the grammar places around it. */
function nameParts(node: SyntaxNode): readonly SyntaxNode[] {
    if (node.kind === "IdentifierName") return [node];
    const parts: SyntaxNode[] = [];
    for (const child of node.children()) {
        if (child.kind === "IdentifierName") parts.push(child);
        else if (nameKinds.has(child.kind)) parts.push(...nameParts(child));
    }
    return parts;
}

function firstChild(node: SyntaxNode): SyntaxNode | undefined {
    for (const child of node.children()) return child;
    return undefined;
}

function firstOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
    }
    return undefined;
}
