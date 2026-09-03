/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode } from "@lezer/common";
import type { SyntaxDiagnostic } from "../contracts.js";

/**
 * Index option lists are closed: an option word the list does not define is a syntax error, and a
 * defined word constrains the shape of its value. The grammar keeps the list generic so that a
 * misspelled option still produces a well-formed tree, which leaves the contract to be checked
 * here against the parsed option nodes.
 */
type ValueShape =
    /** ON or OFF only. */
    | "switch"
    /** A whole number, optionally followed by a unit word such as MINUTES. */
    | "integer"
    /** A row/page/columnstore compression level. */
    | "compression"
    /** A quoted name, as the vector index metric and type take. */
    | "text"
    /** ON, OFF, or a number: the shape an option word without its own value state accepts. */
    | "switchOrNumber"
    /** Anything the option grammar can produce. */
    | "open";

interface OptionContract {
    readonly value: ValueShape;
    /** The option list this option's own parentheses hold, when it takes one. */
    readonly nested?: ReadonlyMap<string, OptionContract>;
}

const switchOrNumberExpectation = "'-', INTEGER, NUMERIC, OFF, or ON";
const numberExpectation = "'-', INTEGER, or NUMERIC";
const groupedQueryExpectation = "'(', or SELECT";

const compressionLevels = new Set(["NONE", "ROW", "PAGE", "COLUMNSTORE", "COLUMNSTORE_ARCHIVE"]);

const lowPriorityOptions: ReadonlyMap<string, OptionContract> = new Map([
    ["ABORT_AFTER_WAIT", { value: "open" } as OptionContract],
    ["MAX_DURATION", { value: "integer" }],
]);

const onlineOptions: ReadonlyMap<string, OptionContract> = new Map([
    ["WAIT_AT_LOW_PRIORITY", { value: "open", nested: lowPriorityOptions } as OptionContract],
]);

const indexOptions = new Map<string, OptionContract>([
    ["ALLOW_PAGE_LOCKS", { value: "switchOrNumber" }],
    ["ALLOW_ROW_LOCKS", { value: "switchOrNumber" }],
    ["BOUNDING_BOX", { value: "open" }],
    ["BUCKET_COUNT", { value: "integer" }],
    ["CELLS_PER_OBJECT", { value: "integer" }],
    ["COMPRESSION_DELAY", { value: "integer" }],
    ["DATA_COMPRESSION", { value: "compression" }],
    ["DISTRIBUTION", { value: "open" }],
    ["DROP_EXISTING", { value: "switchOrNumber" }],
    ["FILESTREAM_ON", { value: "open" }],
    ["FILLFACTOR", { value: "integer" }],
    ["GRIDS", { value: "open" }],
    ["IGNORE_DUP_KEY", { value: "switchOrNumber" }],
    ["L", { value: "integer" }],
    ["M", { value: "integer" }],
    ["MAXDOP", { value: "integer" }],
    ["MAX_DURATION", { value: "integer" }],
    ["METRIC", { value: "text" }],
    ["MOVE", { value: "open" }],
    ["ONLINE", { value: "switch", nested: onlineOptions }],
    ["OPTIMIZE_FOR_ARRAY_SEARCH", { value: "switchOrNumber" }],
    ["OPTIMIZE_FOR_SEQUENTIAL_KEY", { value: "switchOrNumber" }],
    ["PAD_INDEX", { value: "switchOrNumber" }],
    ["R", { value: "integer" }],
    ["RESUMABLE", { value: "switch" }],
    ["SORT_IN_TEMPDB", { value: "switchOrNumber" }],
    ["STATISTICS_INCREMENTAL", { value: "switchOrNumber" }],
    ["STATISTICS_NORECOMPUTE", { value: "switchOrNumber" }],
    ["STATISTICS_ONLY", { value: "switchOrNumber" }],
    ["TYPE", { value: "text" }],
    ["WAIT_AT_LOW_PRIORITY", { value: "open", nested: lowPriorityOptions }],
    ["XML_COMPRESSION", { value: "switchOrNumber" }],
]);

/**
 * ALTER INDEX ... RESUME takes a small numeric option list that also accepts option words it does
 * not define, so only the value shape is constrained there.
 */
const resumeValueExpectation = numberExpectation;

/** Validates the option-word and option-value contract of one index WITH clause. */
export function indexOptionDiagnostics(
    clause: LezerNode,
    text: string,
): readonly SyntaxDiagnostic[] {
    const owner = statementContext(clause);
    if (owner === "unchecked") return [];
    const result: SyntaxDiagnostic[] = [];
    for (const option of optionsOf(clause)) {
        const name = optionName(option);
        if (!name) continue;
        const word = normalize(text.slice(name.from, name.to));
        if (owner === "resume") {
            resumeOptionDiagnostics(option, word, text, result);
            continue;
        }
        const contract = indexOptions.get(word);
        if (!contract) {
            result.push(...unknownOptionDiagnostics(option, name, text, false));
            continue;
        }
        const nested = contract.nested && nestedOptionList(option);
        if (nested) {
            result.push(
                ...nestedListDiagnostics(nested.list, contract.nested!, text, nested.named),
            );
            continue;
        }
        const violation = valueViolation(option, contract.value, text);
        if (violation) result.push(violation);
    }
    return result;
}

/**
 * A constraint-backed index takes its own option list. Words that belong to some other index list
 * are reported by the semantic option pass, so only words no index list defines are syntax errors.
 */
export function constraintIndexOptionDiagnostics(
    clause: LezerNode,
    text: string,
): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    const list = childNamed(clause, "GenericOptionList");
    if (!list) return result;
    for (const option of childrenNamed(list, "GenericOption")) {
        const name = optionName(option);
        if (!name) continue;
        if (indexOptions.has(normalize(text.slice(name.from, name.to)))) continue;
        result.push(...unknownOptionDiagnostics(option, name, text, false));
    }
    return result;
}

function resumeOptionDiagnostics(
    option: LezerNode,
    word: string,
    text: string,
    result: SyntaxDiagnostic[],
): void {
    const nested = nestedOptionList(option);
    if (nested) {
        if (word === "WAIT_AT_LOW_PRIORITY") {
            result.push(
                ...nestedListDiagnostics(nested.list, lowPriorityOptions, text, nested.named),
            );
        }
        return;
    }
    const value = childNamed(option, "OptionValue");
    if (value && !isNumeric(value, text)) {
        result.push(incorrectSyntax(text, valueToken(value, text), resumeValueExpectation));
    }
}

function nestedListDiagnostics(
    list: LezerNode,
    contracts: ReadonlyMap<string, OptionContract>,
    text: string,
    named: boolean,
): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (const option of childrenNamed(list, "GenericOption")) {
        const name = optionName(option);
        if (!name) continue;
        const contract = contracts.get(normalize(text.slice(name.from, name.to)));
        if (!contract) {
            // Recovery inside a nested list stops at its first unknown word.
            result.push(...unknownOptionDiagnostics(option, name, text, named));
            return result;
        }
        const nested = contract.nested && nestedOptionList(option);
        if (nested) {
            const inner = nestedListDiagnostics(nested.list, contract.nested!, text, nested.named);
            if (inner.length > 0) return [...result, ...inner];
            continue;
        }
        const violation = valueViolation(option, contract.value, text);
        if (violation) {
            result.push(violation);
            return result;
        }
    }
    return result;
}

/**
 * An unknown option word is reported where it stands. A word the list cannot place is also read as
 * the head of a parenthesized query, so a list that follows it reports its own first word too.
 */
function unknownOptionDiagnostics(
    option: LezerNode,
    name: LezerNode,
    text: string,
    afterOptionName: boolean,
): readonly SyntaxDiagnostic[] {
    const expectation = afterOptionName ? groupedQueryExpectation : undefined;
    const result = [incorrectSyntax(text, { start: name.from, end: name.to }, expectation)];
    if (expectation) return result;
    const nested = nestedOptionList(option);
    const first = nested?.named
        ? optionName(childrenNamed(nested.list, "GenericOption")[0])
        : undefined;
    if (first) {
        result.push(
            incorrectSyntax(text, { start: first.from, end: first.to }, groupedQueryExpectation),
        );
    }
    return result;
}

function valueViolation(
    option: LezerNode,
    shape: ValueShape,
    text: string,
): SyntaxDiagnostic | undefined {
    if (shape === "open") return undefined;
    const value = childNamed(option, "OptionValue");
    if (!value) return undefined;
    const source = text.slice(value.from, value.to).trim();
    switch (shape) {
        case "switch":
            return isSwitch(source)
                ? undefined
                : incorrectSyntax(text, valueToken(value, text), "OFF, or ON");
        case "integer":
            return isNumeric(value, text)
                ? undefined
                : incorrectSyntax(text, valueToken(value, text), "INTEGER");
        case "compression":
            return compressionLevels.has(normalize(source))
                ? undefined
                : incorrectSyntax(text, valueToken(value, text));
        case "text":
            return childNamed(value, "Literal") || childNamed(value, "StringLiteral")
                ? undefined
                : incorrectSyntax(text, valueToken(value, text), switchOrNumberExpectation);
        case "switchOrNumber":
            return isSwitch(source) || isNumeric(value, text)
                ? undefined
                : incorrectSyntax(text, valueToken(value, text), switchOrNumberExpectation);
    }
}

function isSwitch(source: string): boolean {
    const word = normalize(source);
    return word === "ON" || word === "OFF";
}

/** A numeric option value may be signed and may carry a trailing unit word such as MINUTES. */
function isNumeric(value: LezerNode, text: string): boolean {
    return /^[-+]?\d+(?:\.\d+)?(?:\s+[\p{L}_][\p{L}\p{N}_$#@]*)?$/u.test(
        text.slice(value.from, value.to).trim(),
    );
}

/** The reported range is the first token of the value, not the whole value clause. */
function valueToken(value: LezerNode, text: string): { start: number; end: number } {
    const source = text.slice(value.from, value.to);
    const token =
        /^(?:N?'(?:''|[^'])*'|@[\p{L}_][\p{L}\p{N}_$#@]*|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_$#@]*)/u.exec(
            source,
        )?.[0];
    return { start: value.from, end: value.from + (token?.length ?? 1) };
}

/**
 * An option's nested list is either written directly after its name, as WAIT_AT_LOW_PRIORITY (...)
 * is, or after an ON value, as ONLINE = ON (...) is. Only the first form places the list's own
 * words where a parenthesized query would otherwise start.
 */
function nestedOptionList(
    option: LezerNode,
): { readonly list: LezerNode; readonly named: boolean } | undefined {
    const direct = childNamed(option, "GenericOptionList");
    if (direct) return { list: direct, named: true };
    const value = childNamed(option, "OptionValue");
    const nested = value && childNamed(value, "GenericOptionList");
    return nested ? { list: nested, named: false } : undefined;
}

function statementContext(clause: LezerNode): "checked" | "resume" | "unchecked" {
    for (let current: LezerNode | null = clause.parent; current; current = current.parent) {
        if (current.name === "CreateVectorIndexStatement") return "unchecked";
        if (current.name === "AlterIndexOperation") {
            return childNamed(current, "Resume") ? "resume" : "checked";
        }
        if (/Statement$/u.test(current.name)) break;
    }
    return "checked";
}

function optionsOf(clause: LezerNode): readonly LezerNode[] {
    const result: LezerNode[] = [];
    for (const wrapper of childrenNamed(clause, "IndexOption")) {
        for (const option of childrenNamed(wrapper, "GenericOption")) result.push(option);
    }
    const list = childNamed(clause, "GenericOptionList");
    if (list) result.push(...childrenNamed(list, "GenericOption"));
    return result;
}

function optionName(option: LezerNode | undefined): LezerNode | undefined {
    if (!option) return undefined;
    const name = childNamed(option, "GenericOptionName");
    return name ? (childNamed(name, "IdentifierName") ?? name) : undefined;
}

/** Option words compare by their identifier value, so a delimited spelling matches a bare one. */
function normalize(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1).replaceAll("]]", "]").toUpperCase();
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replaceAll('""', '"').toUpperCase();
    }
    return trimmed.toUpperCase();
}

function incorrectSyntax(
    text: string,
    range: { start: number; end: number },
    expected?: string,
): SyntaxDiagnostic {
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
