/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot } from "../syntax/index.js";
import type { SemanticDiagnostic } from "./contracts.js";

const requiredVectorSearchParameters = ["TABLE", "COLUMN", "SIMILAR_TO", "METRIC"] as const;
const allowedVectorSearchParameters = new Set([
    ...requiredVectorSearchParameters,
    "TOP_N",
    "L",
    "M",
    "START_ID",
]);
const orderedVectorSearchParameters = [
    "TABLE",
    "COLUMN",
    "SIMILAR_TO",
    "METRIC",
    "TOP_N",
    "L",
    "M",
    "START_ID",
] as const;

/** Validates SQL Server 2025 vector contracts that are deliberately broader than the grammar. */
export function vectorSemanticDiagnostics(
    syntax: SyntaxSnapshot,
    root: SyntaxNode,
): readonly SemanticDiagnostic[] {
    const diagnostics: SemanticDiagnostic[] = [];
    visit(root, (node) => {
        if (node.kind === "VectorSearchTableSource") {
            validateVectorSearch(syntax, node, diagnostics);
        } else if (node.kind === "FunctionCall") {
            validateVectorFunction(syntax, node, diagnostics);
        } else if (node.kind === "SelectStatement") {
            validateApproximateQuery(syntax, node, diagnostics);
        } else if (node.kind === "CreateVectorIndexStatement") {
            validateVectorIndex(syntax, node, diagnostics);
        }
    });
    return diagnostics;
}

function validateVectorSearch(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
    diagnostics: SemanticDiagnostic[],
): void {
    const parameters = directDescendants(node, "VectorSearchParameter").map((parameter) => {
        const text = sourceText(syntax, parameter);
        const equal = text.indexOf("=");
        return {
            node: parameter,
            name: equal < 0 ? text.trim().toUpperCase() : text.slice(0, equal).trim().toUpperCase(),
            value: equal < 0 ? "" : text.slice(equal + 1).trim(),
        };
    });
    const names = parameters.map(({ name }) => name);
    const keywordEnd = node.start + "VECTOR_SEARCH".length;

    for (const name of requiredVectorSearchParameters) {
        if (names.includes(name)) continue;
        diagnostics.push(
            error(
                "VEC002",
                `VECTOR_SEARCH requires the ${name} parameter.`,
                node.start,
                keywordEnd,
            ),
        );
    }
    for (const parameter of parameters) {
        if (parameter.name === "FOR INDEX CREATE") {
            diagnostics.push(
                error(
                    "VEC002",
                    "FOR INDEX CREATE is reserved for internal use.",
                    parameter.node.start,
                    parameter.node.end,
                ),
            );
        } else if (!allowedVectorSearchParameters.has(parameter.name)) {
            diagnostics.push(
                error(
                    "VEC002",
                    `'${parameter.name}' is not a valid VECTOR_SEARCH parameter.`,
                    parameter.node.start,
                    parameter.node.end,
                ),
            );
        }
    }
    for (const duplicate of duplicateNames(names)) {
        const parameter = parameters.find(({ name }) => name === duplicate)!;
        diagnostics.push(
            error(
                "VEC002",
                `VECTOR_SEARCH parameter ${duplicate} is specified more than once.`,
                parameter.node.start,
                parameter.node.end,
            ),
        );
    }
    const knownNames = names.filter((name) => allowedVectorSearchParameters.has(name));
    if (
        knownNames.some((name, index) => {
            if (index === 0) return false;
            return (
                orderedVectorSearchParameters.indexOf(
                    name as (typeof orderedVectorSearchParameters)[number],
                ) <
                orderedVectorSearchParameters.indexOf(
                    knownNames[index - 1] as (typeof orderedVectorSearchParameters)[number],
                )
            );
        })
    ) {
        diagnostics.push(
            error(
                "VEC002",
                "VECTOR_SEARCH parameters must appear in that order: TABLE, COLUMN, SIMILAR_TO, METRIC, TOP_N, L, M, START_ID.",
                node.start,
                node.end,
            ),
        );
    }

    const table = parameters.find(({ name }) => name === "TABLE");
    if (table && !isTableArgument(table.value)) {
        diagnostics.push(
            error(
                "VEC002",
                "The VECTOR_SEARCH TABLE parameter must be a table name with an optional alias.",
                valueStart(table.node, syntax),
                table.node.end,
            ),
        );
    }

    const column = parameters.find(({ name }) => name === "COLUMN");
    if (
        column &&
        (multipartIdentifierParts(column.value).length !== 1 || /[@()]/u.test(column.value))
    ) {
        diagnostics.push(
            error(
                "VEC002",
                "The VECTOR_SEARCH COLUMN parameter must be a one-part column name.",
                valueStart(column.node, syntax),
                column.node.end,
            ),
        );
    }
    const metric = parameters.find(({ name }) => name === "METRIC");
    if (metric && !/^N?'(?:cosine|euclidean|dot)'$/iu.test(metric.value)) {
        diagnostics.push(
            error(
                "VEC002",
                "The VECTOR_SEARCH METRIC parameter must be 'cosine', 'euclidean', or 'dot'.",
                valueStart(metric.node, syntax),
                metric.node.end,
            ),
        );
    }
    for (const name of ["TOP_N", "L", "M", "START_ID"] as const) {
        const parameter = parameters.find((candidate) => candidate.name === name);
        if (parameter && !isIntegerVariableOrColumn(parameter.value, name === "START_ID")) {
            diagnostics.push(
                error(
                    "VEC002",
                    `The VECTOR_SEARCH ${name} parameter must be a ${name === "START_ID" ? "non-negative" : "positive"} integer, variable, or column reference.`,
                    valueStart(parameter.node, syntax),
                    parameter.node.end,
                ),
            );
        }
    }
    const hasL = names.includes("L");
    const hasM = names.includes("M");
    if (hasL !== hasM) {
        diagnostics.push(
            error(
                "VEC002",
                "VECTOR_SEARCH L and M parameters must be specified together.",
                node.start,
                node.end,
            ),
        );
    }
    if ((hasL || hasM || names.includes("START_ID")) && !names.includes("TOP_N")) {
        diagnostics.push(
            error(
                "VEC002",
                "VECTOR_SEARCH TOP_N is required when L, M, or START_ID is specified.",
                node.start,
                node.end,
            ),
        );
    }
    for (const parameter of parameters) {
        if (hasDescendant(parameter.node, "ParenthesizedQuery")) {
            diagnostics.push(
                error(
                    "VEC002",
                    `A subquery is not allowed for the ${parameter.name} parameter.`,
                    valueStart(parameter.node, syntax),
                    parameter.node.end,
                ),
            );
        }
    }
}

function isTableArgument(value: string): boolean {
    const withoutAlias = value.replace(
        /\s+(?:AS\s+)?(?:\[[^\]]+\]|"[^"]+"|[\p{L}_#][\p{L}\p{N}_$#@]*)\s*$/iu,
        "",
    );
    const candidate = withoutAlias === value ? value : withoutAlias;
    return isMultipartIdentifier(candidate.trim());
}

function isMultipartIdentifier(value: string): boolean {
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_#][\p{L}\p{N}_$#@]*)`;
    return new RegExp(`^${identifier}(?:\\.${identifier}){0,3}$`, "iu").test(value);
}

function isIntegerVariableOrColumn(value: string, allowZero: boolean): boolean {
    if ((allowZero ? /^[+]?[0-9]+$/u : /^[+]?[1-9][0-9]*$/u).test(value.trim())) return true;
    if (/^@[\p{L}_][\p{L}\p{N}_$#@]*$/iu.test(value.trim())) return true;
    return isMultipartIdentifier(value.trim());
}

function validateVectorFunction(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
    diagnostics: SemanticDiagnostic[],
): void {
    const text = sourceText(syntax, node);
    const name = /^\s*([\p{L}_][\p{L}\p{N}_$#@]*)/u.exec(text)?.[1]?.toUpperCase();
    const expected = name && vectorFunctionArities[name];
    if (!name || !expected) return;
    const open = text.indexOf("(");
    const close = matchingCloseParen(text, open);
    const count = open < 0 || close < 0 ? 0 : countTopLevelArguments(text.slice(open + 1, close));
    if (count < expected[0] || count > expected[1]) {
        const description =
            expected[0] === expected[1] ? `${expected[0]}` : `${expected[0]} to ${expected[1]}`;
        diagnostics.push(
            error(
                "VEC001",
                `${name} requires ${description} argument${expected[1] === 1 ? "" : "s"}.`,
                node.start,
                node.start + name.length,
            ),
        );
    }
}

const vectorFunctionArities: Readonly<Record<string, readonly [number, number]>> = {
    VECTOR_DISTANCE: [3, 3],
    VECTOR_NORM: [2, 2],
    VECTOR_NORMALIZE: [2, 2],
};

function validateApproximateQuery(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
    diagnostics: SemanticDiagnostic[],
): void {
    const approximate = descendants(node, "ApproximateKeyword");
    if (approximate.length === 0) return;
    const marker = approximate[0]!;
    const fetch =
        ancestor(marker, "ApproximateFetchClause") ?? ancestor(marker, "OffsetFetchClause");
    const label = fetch ? "FETCH APPROX" : "TOP WITH APPROX";
    const vectorSources = descendants(node, "VectorSearchTableSource");
    if (vectorSources.length === 0) {
        diagnostics.push(
            error(
                "VEC003",
                `${label} requires VECTOR_SEARCH in the FROM clause.`,
                marker.start,
                marker.end,
            ),
        );
        return;
    }
    if (fetch?.kind === "OffsetFetchClause") {
        diagnostics.push(
            error("VEC003", "FETCH APPROX cannot be combined with OFFSET.", fetch.start, fetch.end),
        );
    }
    const top = ancestor(marker, "TopClause");
    if (top && hasDescendant(top, "Percent")) {
        diagnostics.push(
            error("VEC003", "TOP WITH APPROX cannot be combined with PERCENT.", top.start, top.end),
        );
    }
    const order = firstDescendant(node, "OrderByClause");
    const items = order ? directDescendants(order, "OrderExpression") : [];
    if (!order) {
        diagnostics.push(
            error(
                "VEC003",
                `${label} requires ORDER BY on the VECTOR_SEARCH distance column.`,
                marker.start,
                marker.end,
            ),
        );
        return;
    }
    if (items.length !== 1) {
        diagnostics.push(
            error(
                "VEC003",
                `${label} ORDER BY must have exactly one item.`,
                order.start,
                order.end,
            ),
        );
        return;
    }
    const itemText = sourceText(syntax, items[0]!).trim();
    if (/\bDESC\s*$/iu.test(itemText)) {
        diagnostics.push(
            error(
                "VEC003",
                `${label} ORDER BY must be ascending (ASC).`,
                items[0]!.start,
                items[0]!.end,
            ),
        );
    }
    const reference = itemText.replace(/\s+(?:ASC|DESC)\s*$/iu, "").trim();
    const parts = multipartIdentifierParts(reference);
    if (parts.at(-1)?.toUpperCase() !== "DISTANCE") {
        diagnostics.push(
            error(
                "VEC003",
                `${label} ORDER BY must reference the VECTOR_SEARCH distance column.`,
                items[0]!.start,
                items[0]!.end,
            ),
        );
    } else if (parts.length > 1) {
        const aliases = vectorSources
            .map((source) => firstDescendant(source, "TableAlias"))
            .filter((alias): alias is SyntaxNode => alias !== undefined)
            .map((alias) =>
                sourceText(syntax, alias)
                    .replace(/^\s*AS\s+/iu, "")
                    .trim(),
            )
            .map((alias) => alias.replace(/^\[|\]$/gu, "").toUpperCase());
        if (!aliases.includes(parts.at(-2)!.toUpperCase())) {
            diagnostics.push(
                error(
                    "VEC003",
                    `${label} ORDER BY alias must match a VECTOR_SEARCH alias.`,
                    items[0]!.start,
                    items[0]!.end,
                ),
            );
        }
    }
}

function validateVectorIndex(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
    diagnostics: SemanticDiagnostic[],
): void {
    const text = sourceText(syntax, node);
    if (!/\bMETRIC\s*=/iu.test(text)) {
        const name = firstDescendant(node, "IdentifierName");
        diagnostics.push(
            error(
                "IDX001",
                "CREATE VECTOR INDEX requires the METRIC option.",
                name?.start ?? node.start,
                name?.end ?? node.start + "CREATE VECTOR INDEX".length,
            ),
        );
    }
}

function error(code: string, message: string, start: number, end: number): SemanticDiagnostic {
    return { code, message, severity: "error", range: { start, end } };
}

function sourceText(syntax: SyntaxSnapshot, node: SyntaxNode): string {
    return syntax.document.text.slice(node.start, node.end);
}

function valueStart(node: SyntaxNode, syntax: SyntaxSnapshot): number {
    const text = sourceText(syntax, node);
    const equal = text.indexOf("=");
    if (equal < 0) return node.start;
    let offset = equal + 1;
    while (/\s/u.test(text[offset] ?? "")) offset++;
    return node.start + offset;
}

function duplicateNames(names: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const name of names) {
        if (seen.has(name)) duplicates.add(name);
        seen.add(name);
    }
    return [...duplicates];
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visit(child, callback);
}

function descendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    visit(node, (candidate) => {
        if (candidate !== node && candidate.kind === kind) result.push(candidate);
    });
    return result;
}

function directDescendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    return [...node.children()].filter((child) => child.kind === kind);
}

function firstDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendant(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

function hasDescendant(node: SyntaxNode, kind: string): boolean {
    return firstDescendant(node, kind) !== undefined;
}

function ancestor(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (let current = node.parent(); current; current = current.parent()) {
        if (current.kind === kind) return current;
    }
    return undefined;
}

function matchingCloseParen(text: string, open: number): number {
    let depth = 0;
    let quote = false;
    for (let index = open; index < text.length; index++) {
        const character = text[index]!;
        if (character === "'") {
            if (quote && text[index + 1] === "'") index++;
            else quote = !quote;
        } else if (!quote && character === "(") depth++;
        else if (!quote && character === ")" && --depth === 0) return index;
    }
    return -1;
}

function countTopLevelArguments(text: string): number {
    if (text.trim().length === 0) return 0;
    let count = 1;
    let depth = 0;
    let quote = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (character === "'") {
            if (quote && text[index + 1] === "'") index++;
            else quote = !quote;
        } else if (!quote && character === "(") depth++;
        else if (!quote && character === ")") depth--;
        else if (!quote && depth === 0 && character === ",") count++;
    }
    return count;
}

function multipartIdentifierParts(text: string): readonly string[] {
    const parts: string[] = [];
    const matcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
    for (const match of text.matchAll(matcher)) {
        const value = match[0];
        parts.push(
            value.startsWith("[") && value.endsWith("]")
                ? value.slice(1, -1).replaceAll("]]", "]")
                : value.startsWith('"') && value.endsWith('"')
                  ? value.slice(1, -1).replaceAll('""', '"')
                  : value,
        );
    }
    return parts;
}
