/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import {
    type BlockNode,
    type CreateNode,
    type DeclareNode,
    type Program,
    type SelectNode,
    type ReturnNode,
    type TryCatchNode,
    type Statement,
    type WithNode,
} from "./ast/types.js";

export type DocumentSymbolKind =
    | "file"
    | "module"
    | "namespace"
    | "class"
    | "method"
    | "property"
    | "field"
    | "constructor"
    | "enum"
    | "interface"
    | "function"
    | "variable"
    | "constant"
    | "string"
    | "number"
    | "boolean"
    | "array"
    | "object"
    | "key"
    | "null"
    | "enumMember"
    | "struct"
    | "event"
    | "operator"
    | "typeParameter";

export interface DocumentSymbol {
    name: string;
    kind: DocumentSymbolKind;
    start: number;
    end: number;
    selectionStart: number;
    selectionEnd: number;
    detail?: string;
    children?: DocumentSymbol[];
}

export function getDocumentSymbols(program: Program): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];

    for (const stmt of program.body) {
        symbols.push(...statementSymbols(stmt));
    }

    return symbols;
}

function statementSymbols(stmt: Statement): DocumentSymbol[] {
    switch (stmt.type) {
        case "BatchSeparatorStatement":
            return [];

        case "CreateStatement":
            return [createSymbol(stmt)];

        case "DeclareStatement":
            return declareSymbols(stmt);

        case "WithStatement":
            return withSymbols(stmt);

        case "SelectStatement":
            return [selectSymbol(stmt)];

        case "SetOperator":
            return [...statementSymbols(stmt.left), ...statementSymbols(stmt.right)];

        case "BlockStatement":
            return blockSymbols(stmt);

        case "IfStatement":
            return [...branchSymbols(stmt.thenBranch), ...branchSymbols(stmt.elseBranch)];

        case "TryCatchStatement":
            return [
                ...blockSymbols((stmt as TryCatchNode).tryBlock),
                ...blockSymbols((stmt as TryCatchNode).catchBlock),
            ];

        case "ReturnStatement":
            return (stmt as ReturnNode).query ? statementSymbols((stmt as ReturnNode).query!) : [];

        default:
            return [];
    }
}

function createSymbol(stmt: CreateNode): DocumentSymbol {
    const children: DocumentSymbol[] = [];

    for (const param of stmt.parameters ?? []) {
        children.push({
            name: param.name,
            kind: "variable",
            detail: param.dataType,
            start: param.start,
            end: param.end,
            selectionStart: param.start,
            selectionEnd: param.start + param.name.length,
        });
    }

    for (const col of stmt.columns ?? []) {
        children.push({
            name: col.name,
            kind: "field",
            detail: col.dataType,
            start: col.start,
            end: col.end,
            selectionStart: col.start,
            selectionEnd: col.start + col.name.length,
        });
    }

    if (Array.isArray(stmt.body)) {
        for (const child of stmt.body) {
            children.push(...statementSymbols(child));
        }
    } else if (stmt.body) {
        children.push(...statementSymbols(stmt.body));
    }

    return {
        name: stmt.name || "<anonymous>",
        kind: createKind(stmt),
        detail: stmt.objectType,
        start: stmt.start,
        end: stmt.end,
        selectionStart: stmt.nameNode.start,
        selectionEnd: stmt.nameNode.end,
        ...(children.length ? { children } : {}),
    };
}

function declareSymbols(stmt: DeclareNode): DocumentSymbol[] {
    return stmt.variables.map((variable) => ({
        name: variable.name,
        kind: "variable",
        detail: variable.dataType,
        start: variable.start,
        end: variable.end,
        selectionStart: variable.start,
        selectionEnd: variable.start + variable.name.length,
    }));
}

function withSymbols(stmt: WithNode): DocumentSymbol[] {
    const ctes = stmt.ctes.map((cte) => ({
        name: cte.name,
        kind: "namespace" as const,
        detail: "CTE",
        start: cte.start,
        end: cte.end,
        selectionStart: cte.start,
        selectionEnd: cte.start + cte.name.length,
        children: statementSymbols(cte.query),
    }));

    return [...ctes, ...statementSymbols(stmt.body)];
}

function selectSymbol(stmt: SelectNode): DocumentSymbol {
    return {
        name: "SELECT",
        kind: "function",
        start: stmt.start,
        end: stmt.end,
        selectionStart: stmt.start,
        selectionEnd: Math.min(stmt.start + "SELECT".length, stmt.end),
        children: stmt.columns.map((col) => ({
            name: col.outputName,
            kind: col.wildcard ? "array" : "field",
            start: col.start,
            end: col.end,
            selectionStart: col.start,
            selectionEnd: col.end,
        })),
    };
}

function blockSymbols(stmt: BlockNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];

    for (const child of stmt.body) {
        symbols.push(...statementSymbols(child));
    }

    return symbols;
}

function branchSymbols(branch: Statement | Statement[] | undefined): DocumentSymbol[] {
    if (!branch) return [];
    if (Array.isArray(branch)) return branch.flatMap(statementSymbols);
    return statementSymbols(branch);
}

function createKind(stmt: CreateNode): DocumentSymbolKind {
    switch (stmt.objectType) {
        case "PROCEDURE":
            return "method";
        case "FUNCTION":
            return "function";
        case "VIEW":
            return "interface";
        case "TYPE":
            return "struct";
        case "TABLE":
        default:
            return "class";
    }
}
