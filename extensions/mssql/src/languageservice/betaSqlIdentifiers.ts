/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { partitionSqlBatches, type SqlBatchRegion } from "@vscode-mssql/tsql-language-service";
import { tsqlReservedKeywords } from "./tsqlKeywords";
import type {
    InsertValuesContext,
    ObjectReference,
    RoutineCallContext,
    SchemaLeaf,
    SchemaMapping,
} from "./betaSqlLanguageServiceTypes";

export function isLocalObjectName(name: string): boolean {
    return name.startsWith("#") || name.startsWith("@");
}

/**
 * Longest text before the caret that any caret-anchored completion probe inspects. These probes
 * used to slice the whole document, which made every keystroke cost O(file size).
 */
export const maximumCompletionPrefixLength = 8192;

export interface CompletionPrefix {
    /** Document text ending at the caret, truncated at the front. */
    readonly text: string;
    /** Document offset of `text[0]`, needed whenever a match index becomes a document offset. */
    readonly startOffset: number;
    readonly endOffset: number;
}

export function getCompletionPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
): CompletionPrefix {
    const endOffset = document.offsetAt(position);
    const startOffset = Math.max(0, endOffset - maximumCompletionPrefixLength);
    return {
        text: document.getText(new vscode.Range(document.positionAt(startOffset), position)),
        startOffset,
        endOffset,
    };
}

let cachedBatchPartition: { text: string; regions: readonly SqlBatchRegion[] } | undefined;

export function getBatchRegions(text: string): readonly SqlBatchRegion[] {
    if (cachedBatchPartition?.text !== text) {
        cachedBatchPartition = { text, regions: partitionSqlBatches(text) };
    }
    return cachedBatchPartition.regions;
}

/**
 * Completion recovery re-parses text with a synthetic token inserted. Scoping it to the enclosing
 * `GO` batch keeps that cost proportional to the batch rather than the file, and T-SQL name
 * resolution never crosses a batch separator.
 */
export function getRecoveryWindow(
    text: string,
    offset: number,
): { readonly text: string; readonly offset: number } {
    const region = getBatchRegions(text).find(
        (candidate) =>
            offset >= candidate.start && offset <= candidate.start + candidate.text.length,
    );
    return region ? { text: region.text, offset: offset - region.start } : { text, offset };
}

export function sqlIdentifierPattern(allowIncomplete: boolean): string {
    const bracketed = allowIncomplete
        ? String.raw`\[(?:[^\]\r\n]|\]\])*\]?`
        : String.raw`\[(?:[^\]\r\n]|\]\])*\]`;
    const quoted = allowIncomplete
        ? String.raw`"(?:[^"\r\n]|"")*"?`
        : String.raw`"(?:[^"\r\n]|"")*"`;
    return String.raw`(?:${bracketed}|${quoted}|[A-Za-z_@#][\w$#@]*)`;
}

export function quoteCompletionIdentifier(value: string): string {
    if (
        value.startsWith("@") ||
        (/^[A-Za-z_#][\w$#@]*$/.test(value) &&
            !tsqlReservedKeywords.some((keyword) => keyword.toLowerCase() === value.toLowerCase()))
    ) {
        return value;
    }
    return `[${value.replaceAll("]", "]]")}]`;
}

export function deduplicatePaths(
    paths: readonly (readonly string[])[],
): readonly (readonly string[])[] {
    const seen = new Set<string>();
    return paths.filter((parts) => {
        const key = parts.map((part) => part.toLowerCase()).join("\u0000");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function isSchemaLeaf(
    value: SchemaMapping | Exclude<SchemaLeaf, string>,
): value is Exclude<SchemaLeaf, string> {
    return "type" in value || "nullable" in value;
}

export function parseObjectReference(value: string | undefined): ObjectReference | undefined {
    if (!value) {
        return undefined;
    }
    const parts = splitMultipartIdentifier(value);
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 1) {
        return { name: parts[0] };
    }
    if (parts.length === 2) {
        return { schema: parts[0], name: parts[1] };
    }
    if (parts.length === 3) {
        return { database: parts[0], schema: parts[1], name: parts[2] };
    }
    return {
        server: parts.at(-4),
        database: parts.at(-3),
        schema: parts.at(-2),
        name: parts.at(-1)!,
    };
}

export function getCompletionPath(value: string): { qualifiers: string[]; prefix: string } {
    const trimmed = value.trim();
    if (!trimmed) {
        return { qualifiers: [], prefix: "" };
    }
    const trailingDot = /\.\s*$/.test(trimmed);
    const parts = splitMultipartIdentifier(trimmed.replace(/\.\s*$/, ""));
    return trailingDot
        ? { qualifiers: parts, prefix: "" }
        : { qualifiers: parts.slice(0, -1), prefix: parts.at(-1) ?? "" };
}

export function isPartialMultipartIdentifier(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        return true;
    }
    const identifier = sqlIdentifierPattern(true);
    return new RegExp(String.raw`^${identifier}(?:\s*\.\s*${identifier}){0,3}\s*$`, "i").test(
        trimmed,
    );
}

export function getCompletionIdentifierPrefix(value: string): string {
    const match = new RegExp(`(${sqlIdentifierPattern(true)})$`).exec(value);
    return match ? unquoteIdentifier(match[1]) : "";
}

export function getRoutineCallContext(prefix: string): RoutineCallContext | undefined {
    const openParen = findActiveOpenParenthesis(prefix);
    if (openParen === undefined) {
        return undefined;
    }
    const identifier = sqlIdentifierPattern(false);
    const match = new RegExp(
        String.raw`(${identifier}(?:\s*\.\s*${identifier}){0,3})\s*$`,
        "i",
    ).exec(prefix.slice(0, openParen));
    const routine = parseObjectReference(match?.[1]);
    return routine
        ? {
              routine,
              activeParameter: Math.max(
                  0,
                  splitTopLevel(prefix.slice(openParen + 1), ",").length - 1,
              ),
              kind: "function",
          }
        : undefined;
}

export function getExecuteRoutineCallContext(prefix: string): RoutineCallContext | undefined {
    const identifier = sqlIdentifierPattern(false);
    const match = new RegExp(
        String.raw`\bexec(?:ute)?\s+(?:@[A-Za-z_][\w$#@]*\s*=\s*)?(${identifier}(?:\s*\.\s*${identifier}){0,3})(?:\s+([^;]*))?$`,
        "i",
    ).exec(prefix);
    const routine = parseObjectReference(match?.[1]);
    if (!routine) {
        return undefined;
    }
    return {
        routine,
        activeParameter: Math.max(0, splitTopLevel(match?.[2] ?? "", ",").length - 1),
        kind: "execute",
    };
}

export function getInsertValuesContext(prefix: string): InsertValuesContext | undefined {
    const openParen = findActiveOpenParenthesis(prefix);
    if (openParen === undefined) {
        return undefined;
    }
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const pattern = new RegExp(
        String.raw`\binsert\s+into\s+(${qualifiedIdentifier})(?:\s*\(([^)]*)\))?\s+values\b`,
        "gi",
    );
    const beforeRow = prefix.slice(0, openParen);
    let insertMatch: RegExpExecArray | undefined;
    for (let match = pattern.exec(beforeRow); match; match = pattern.exec(beforeRow)) {
        insertMatch = match;
    }
    const target = parseObjectReference(insertMatch?.[1]);
    if (!insertMatch || !target) {
        return undefined;
    }
    const completedRows = beforeRow.slice(insertMatch.index + insertMatch[0].length);
    if (completedRows.trim()) {
        const rowSegments = splitTopLevel(completedRows, ",");
        if (
            rowSegments.at(-1)?.trim() ||
            rowSegments.slice(0, -1).some((row) => !/^\s*\([\s\S]*\)\s*$/.test(row))
        ) {
            return undefined;
        }
    }
    const columns = insertMatch[2]
        ? splitTopLevel(insertMatch[2], ",")
              .map((column) => unquoteIdentifier(column.trim()))
              .filter(Boolean)
        : undefined;
    return {
        target,
        columns,
        activeParameter: Math.max(0, splitTopLevel(prefix.slice(openParen + 1), ",").length - 1),
    };
}

export function findActiveOpenParenthesis(text: string): number | undefined {
    const stack: number[] = [];
    let quote: "'" | '"' | "]" | undefined;
    let lineComment = false;
    let blockCommentDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (lineComment) {
            if (character === "\n" || character === "\r") {
                lineComment = false;
            }
            continue;
        }
        if (blockCommentDepth > 0) {
            if (character === "/" && next === "*") {
                blockCommentDepth++;
                index++;
            } else if (character === "*" && next === "/") {
                blockCommentDepth--;
                index++;
            }
            continue;
        }
        if (quote) {
            if (character === quote) {
                if (next === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "-" && next === "-") {
            lineComment = true;
            index++;
        } else if (character === "/" && next === "*") {
            blockCommentDepth = 1;
            index++;
        } else if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            stack.push(index);
        } else if (character === ")") {
            stack.pop();
        }
    }
    return stack.at(-1);
}

export function splitMultipartIdentifier(value: string): string[] {
    const parts: string[] = [];
    let current = "";
    let quote: "]" | '"' | undefined;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            current += character;
            if (character === quote) {
                if (value[index + 1] === quote) {
                    current += value[++index];
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "[") {
            quote = "]";
            current += character;
        } else if (character === '"') {
            quote = '"';
            current += character;
        } else if (character === ".") {
            parts.push(unquoteIdentifier(current.trim()));
            current = "";
        } else {
            current += character;
        }
    }
    if (current.trim()) {
        parts.push(unquoteIdentifier(current.trim()));
    }
    return parts.filter(Boolean);
}

export function unquoteIdentifier(value: string): string {
    if (value.startsWith("[")) {
        return value.slice(1, value.endsWith("]") ? -1 : undefined).replaceAll("]]", "]");
    }
    const unicodeString = value.startsWith("N'") || value.startsWith("n'");
    if ((unicodeString || value.startsWith("'")) && value.endsWith("'")) {
        return value.slice(unicodeString ? 2 : 1, -1).replaceAll("''", "'");
    }
    if (value.startsWith('"')) {
        return value.slice(1, value.endsWith('"') ? -1 : undefined).replaceAll('""', '"');
    }
    return value;
}

/** Closes an editor's unfinished quoted identifier at EOF so parser recovery stays silent. */
export function getParseableEditorText(text: string): string {
    let state: "normal" | "string" | "bracket" | "quoted" | "lineComment" | "blockComment" =
        "normal";
    let blockCommentDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (state === "lineComment") {
            if (character === "\n" || character === "\r") {
                state = "normal";
            }
            continue;
        }
        if (state === "blockComment") {
            if (character === "/" && next === "*") {
                blockCommentDepth++;
                index++;
            } else if (character === "*" && next === "/") {
                blockCommentDepth--;
                index++;
                if (blockCommentDepth === 0) {
                    state = "normal";
                }
            }
            continue;
        }
        if (state === "string" || state === "bracket" || state === "quoted") {
            const terminator = state === "string" ? "'" : state === "bracket" ? "]" : '"';
            if (character === terminator) {
                if (next === terminator) {
                    index++;
                } else {
                    state = "normal";
                }
            }
            continue;
        }
        if (character === "-" && next === "-") {
            state = "lineComment";
            index++;
        } else if (character === "/" && next === "*") {
            state = "blockComment";
            blockCommentDepth = 1;
            index++;
        } else if (character === "'") {
            state = "string";
        } else if (character === "[") {
            state = "bracket";
        } else if (character === '"') {
            state = "quoted";
        }
    }
    return state === "bracket" ? `${text}]` : state === "quoted" ? `${text}"` : text;
}

export function collectTextObjectReferences(
    text: string,
    references: Map<string, ObjectReference>,
): void {
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const cteNames = new Set(
        [
            ...text.matchAll(
                new RegExp(String.raw`(?:\bwith|,)\s*(${identifier})\s+as\s*\(`, "gi"),
            ),
        ].map((match) => unquoteIdentifier(match[1]).toLocaleLowerCase()),
    );
    const source = new RegExp(
        String.raw`\b(?:from|join|apply|update|into)\s+(${qualifiedIdentifier})`,
        "gi",
    );
    // Sticky, so the lookahead never copies the rest of the document per match.
    const continuation = /\s*[.(]/uy;
    for (let match = source.exec(text); match; match = source.exec(text)) {
        continuation.lastIndex = source.lastIndex;
        if (continuation.test(text)) {
            continue;
        }
        const reference = parseObjectReference(match[1]);
        if (!reference || cteNames.has(reference.name.toLocaleLowerCase())) {
            continue;
        }
        const key = [reference.server, reference.database, reference.schema, reference.name]
            .filter((part): part is string => Boolean(part))
            .map((part) => part.toLocaleLowerCase())
            .join(".");
        references.set(key, reference);
    }
    const synonymTarget = new RegExp(
        String.raw`\bcreate\s+synonym\s+${qualifiedIdentifier}\s+for\s+(${qualifiedIdentifier})`,
        "gi",
    );
    for (let match = synonymTarget.exec(text); match; match = synonymTarget.exec(text)) {
        const reference = parseObjectReference(match[1]);
        if (!reference) {
            continue;
        }
        const key = [reference.server, reference.database, reference.schema, reference.name]
            .filter((part): part is string => Boolean(part))
            .map((part) => part.toLocaleLowerCase())
            .join(".");
        references.set(key, reference);
    }
}

export function objectReferenceFromParts(parts: readonly string[]): ObjectReference | undefined {
    if (parts.length === 0) {
        return undefined;
    }
    return {
        server: parts.at(-4),
        database: parts.at(-3),
        schema: parts.at(-2),
        name: parts.at(-1)!,
    };
}

export function findMatchingParenthesis(text: string, openParen: number): number {
    let depth = 0;
    let quote: "'" | '"' | "]" | undefined;
    for (let index = openParen; index < text.length; index++) {
        const character = text[index];
        if (quote) {
            if (character === quote) {
                if (text[index + 1] === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "'") {
            quote = "'";
        } else if (character === '"') {
            quote = '"';
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            depth++;
        } else if (character === ")" && --depth === 0) {
            return index;
        }
    }
    return -1;
}

export function splitTopLevel(value: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: "'" | '"' | "]" | undefined;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote) {
                if (value[index + 1] === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            depth++;
        } else if (character === ")") {
            depth--;
        } else if (character === separator && depth === 0) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));
    return parts;
}
