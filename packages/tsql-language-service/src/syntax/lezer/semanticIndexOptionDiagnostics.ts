/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode } from "@lezer/common";
import type { TextRange } from "../../text/index.js";
import type { SyntaxDiagnostic } from "../contracts.js";

/**
 * A semantic index draws its column settings and its option list from fixed vocabularies. The
 * grammar keeps both permissive so that one unrecognized word leaves the rest of the statement
 * intact, which makes each word's vocabulary a check rather than a parse failure.
 */
const searchTypes = new Set(["FULLTEXT", "HYBRID", "VECTOR"]);
const chunkTypes = new Set(["CHAPTER", "FIXED", "PARAGRAPH", "SENTENCE"]);
const chunkIntegerOptions = new Set(["OVERLAP", "SIZE"]);

const externalModelExpectation = "SIW_EXTERNAL_MODEL";
const vectorMetricExpectation = "IO_VECTORINDEXMETRIC";
const groupedQueryExpectation = "'(', or SELECT";
const switchExpectation = "OFF, or ON";
const numberExpectation = "INTEGER, or NUMERIC";

/** Validates one CREATE SEMANTIC INDEX statement's column settings and option list. */
export function semanticIndexOptionDiagnostics(
    statement: LezerNode,
    text: string,
): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (const column of childrenNamed(statement, "SemanticIndexColumn")) {
        result.push(...columnDiagnostics(column, text));
    }
    const clause = childNamed(statement, "SemanticIndexWithClause");
    if (clause) result.push(...optionListDiagnostics(clause, text));
    return result;
}

function columnDiagnostics(column: LezerNode, text: string): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (const option of childrenNamed(column, "SemanticIndexColumnOption")) {
        const searchType = childNamed(option, "SearchType");
        if (searchType) {
            const value = childNamed(option, "IdentifierName");
            if (value && !searchTypes.has(normalize(text.slice(value.from, value.to)))) {
                result.push(near(text, value));
            }
            continue;
        }
        if (!childNamed(option, "ChunkUsing")) continue;
        result.push(...chunkOptionDiagnostics(option, text));
    }
    return result;
}

function chunkOptionDiagnostics(option: LezerNode, text: string): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    const list = childNamed(option, "GenericOptionList");
    if (!list) return result;
    for (const entry of childrenNamed(list, "GenericOption")) {
        const name = optionName(entry);
        const value = childNamed(entry, "OptionValue");
        if (!name || !value) continue;
        const word = normalize(text.slice(name.from, name.to));
        if (word === "TYPE") {
            if (!chunkTypes.has(normalize(text.slice(value.from, value.to)))) {
                result.push(near(text, value));
            }
            continue;
        }
        if (!chunkIntegerOptions.has(word)) continue;
        const sign = childNamed(value, "Minus") ?? childNamed(value, "Plus");
        if (sign) result.push(near(text, sign, numberExpectation));
    }
    return result;
}

/**
 * EXTERNAL_MODEL binds the index to its embedding model and leads the list. A different word there
 * ends the option list, and the parentheses that follow it are then read as a query.
 */
function optionListDiagnostics(clause: LezerNode, text: string): readonly SyntaxDiagnostic[] {
    const options = childrenNamed(clause, "SemanticIndexOption");
    const result: SyntaxDiagnostic[] = [];
    for (const [index, option] of options.entries()) {
        const leading = leadingWord(option);
        if (!leading) continue;
        const word = normalize(text.slice(leading.from, leading.to));
        if (index === 0 && word !== "EXTERNAL_MODEL") {
            result.push(near(text, leading, externalModelExpectation));
            const inner = leadingWord(childrenNamed(option, "SemanticIndexVectorOption")[0]);
            if (inner) result.push(near(text, inner, groupedQueryExpectation));
            return result;
        }
        if (word === "VECTOR_INDEX") {
            const first = leadingWord(childrenNamed(option, "SemanticIndexVectorOption")[0]);
            if (first && normalize(text.slice(first.from, first.to)) !== "METRIC") {
                result.push(near(text, first, vectorMetricExpectation));
                return result;
            }
            continue;
        }
        if (word !== "DROP_EXISTING") continue;
        const value = childNamed(option, "SemanticIndexOptionValue");
        if (value && !/^(?:ON|OFF)$/iu.test(text.slice(value.from, value.to).trim())) {
            result.push(near(text, value, switchExpectation));
            return result;
        }
    }
    return result;
}

/** The word an option leads with, whether the grammar gave it a keyword or a generic name node. */
function leadingWord(option: LezerNode | undefined): LezerNode | undefined {
    if (!option) return undefined;
    for (let child = option.firstChild; child; child = child.nextSibling) {
        if (child.name === "Comma" || child.from === child.to) continue;
        if (child.name === "GenericOptionName") return optionName(child) ?? child;
        return child;
    }
    return undefined;
}

function optionName(node: LezerNode): LezerNode | undefined {
    if (node.name !== "GenericOptionName") {
        const name = childNamed(node, "GenericOptionName");
        return name ? (childNamed(name, "IdentifierName") ?? name) : undefined;
    }
    return childNamed(node, "IdentifierName") ?? node;
}

function normalize(value: string): string {
    return value.trim().toUpperCase();
}

function near(text: string, node: LezerNode, expected?: string): SyntaxDiagnostic {
    const range: TextRange = { start: node.from, end: node.to };
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.start, range.end)}'.${
            expected ? `  Expecting ${expected}.` : ""
        }`,
        severity: "error",
        range,
    };
}

function childNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
    }
    return undefined;
}

function childrenNamed(node: LezerNode, name: string): readonly LezerNode[] {
    const result: LezerNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) result.push(child);
    }
    return result;
}
