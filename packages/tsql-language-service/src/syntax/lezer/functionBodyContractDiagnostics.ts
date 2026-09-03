/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode } from "@lezer/common";
import type { SyntaxDiagnostic } from "../contracts.js";

/**
 * A table-valued function's return type decides which body it may carry.
 *
 * `RETURNS TABLE` with no column list is an inline function and returns one query. `RETURNS TABLE`
 * with a column list declares the shape of a CLR result set, so its body names an external entry
 * point. `RETURNS @t TABLE (…)` is the multi-statement form and keeps a Transact-SQL block. The
 * grammar accepts all three bodies against all three headers so a mismatch stays readable, which
 * leaves the pairing to be checked here.
 */
export function invalidFunctionBody(
    definition: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const returnType = childNamed(definition, "FunctionTableReturnType");
    if (!returnType || childNamed(returnType, "Variable")) return undefined;
    const body = childNamed(definition, "FunctionTableBody");
    if (!body) return undefined;
    const clr = childNamed(returnType, "TableDefinition") !== undefined;
    const functionBody = childNamed(body, "FunctionBody");
    const moduleBody = functionBody && childNamed(functionBody, "ModuleBody");
    // A CLR entry point is written with or without AS, so it stands either under the function body
    // or directly under the clause.
    const external =
        childNamed(body, "ExternalModuleBody") ??
        (moduleBody && childNamed(moduleBody, "ExternalModuleBody"));
    if (clr) {
        if (external) return undefined;
        const token = firstLeaf(functionBody ?? body);
        return token && near(text, token.from, token.to, "EXTERNAL");
    }
    if (external || !moduleBody) return undefined;
    // An inline function returns one query. A body that opens a block is the multi-statement form
    // written without its return variable; a body that starts with RETURN is the inline one, even
    // when a common table expression makes the parser mount it as a module body.
    const first = firstLeaf(moduleBody);
    if (!first || text.slice(first.from, first.to).toUpperCase() !== "BEGIN") return undefined;
    return near(text, moduleBody.from, moduleBody.to);
}

/** A collation is named by a plain identifier, never by a delimited one. */
export function invalidCollationName(
    clause: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const name = childNamed(clause, "IdentifierName");
    const delimited =
        name &&
        (childNamed(name, "BracketedIdentifier") ?? childNamed(name, "DoubleQuotedIdentifier"));
    return delimited ? near(text, delimited.from, delimited.to) : undefined;
}

/**
 * An event session option size or duration carries one of a fixed set of unit words. Any other word
 * after the number is a separate token the option list cannot place.
 */
const eventSessionUnits = new Set([
    "DAY",
    "DAYS",
    "GB",
    "HOUR",
    "HOURS",
    "KB",
    "MB",
    "MINUTE",
    "MINUTES",
    "SECOND",
    "SECONDS",
]);

export function invalidEventSessionUnit(
    value: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    // Only a number followed by a word carries a unit; a bare word is the option's own value.
    const number = childNamed(value, "Literal") ?? childNamed(value, "IntegerLiteral");
    const unit = childNamed(value, "IdentifierName");
    if (!number || !unit || unit.from < number.to) return undefined;
    const word = text.slice(unit.from, unit.to).trim().toUpperCase();
    return eventSessionUnits.has(word) ? undefined : near(text, unit.from, unit.to);
}

/** BACKUP COMPRESSION takes one option, which names the compression algorithm. */
export function invalidBackupCompressionOption(
    option: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const name = optionName(option);
    if (!name || text.slice(name.from, name.to).trim().toUpperCase() !== "COMPRESSION") {
        return undefined;
    }
    const list = childNamed(option, "GenericOptionList");
    for (const nested of list ? childrenNamed(list, "GenericOption") : []) {
        const nestedName = optionName(nested);
        if (!nestedName) continue;
        if (text.slice(nestedName.from, nestedName.to).trim().toUpperCase() === "ALGORITHM") {
            continue;
        }
        return near(text, nestedName.from, nestedName.to, "ALGORITHM");
    }
    return undefined;
}

function optionName(option: LezerNode): LezerNode | undefined {
    const name = childNamed(option, "GenericOptionName");
    return name ? (childNamed(name, "IdentifierName") ?? name) : undefined;
}

function childrenNamed(node: LezerNode, name: string): readonly LezerNode[] {
    const result: LezerNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) result.push(child);
    }
    return result;
}

/**
 * A predicate function answers a condition; it has no value to compare. Writing one as an operand
 * leaves the comparison operator with nothing to stand between.
 */
const predicateFunctions = new Set(["REGEXP_LIKE"]);

const comparisonOperators = new Set([
    "Equal",
    "EqualStar",
    "GreaterThan",
    "GreaterThanOrEqual",
    "LessThan",
    "LessThanOrEqual",
    "NotEqual",
    "StarEqual",
]);

export function invalidPredicateFunctionOperand(
    call: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const name = childNamed(call, "MultipartIdentifier");
    if (!name || !predicateFunctions.has(text.slice(name.from, name.to).trim().toUpperCase())) {
        return undefined;
    }
    for (const sibling of [call.nextSibling, call.prevSibling]) {
        if (sibling && comparisonOperators.has(sibling.name)) {
            return near(text, sibling.from, sibling.to);
        }
    }
    return undefined;
}

function near(text: string, start: number, end: number, expected?: string): SyntaxDiagnostic {
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(start, end)}'.${
            expected ? `  Expecting ${expected}.` : ""
        }`,
        severity: "error",
        range: { start, end },
    };
}

function firstLeaf(node: LezerNode): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        const leaf = child.firstChild ? firstLeaf(child) : child;
        if (leaf && leaf.from < leaf.to) return leaf;
    }
    return node.from < node.to ? node : undefined;
}

function childNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
    }
    return undefined;
}
