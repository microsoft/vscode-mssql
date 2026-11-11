/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL batch splitter + lite lexer (doc 04 §12.3): GO separators that are
 * comment/string/bracket aware by default. The lexer walk is shared with
 * MetadataService's DDL sniffer (B5) — one tokenizer, two consumers.
 *
 * Rules:
 *  - a separator is a LINE containing only `GO` (case-insensitive), an
 *    optional integer count, and an optional trailing `--` comment;
 *  - `GO n` repeats the preceding batch n times (repeatOrdinal per run);
 *  - GO inside block/line comments, strings, or bracketed identifiers does
 *    not split;
 *  - empty batches are skipped;
 *  - output carries startLine (0-based, relative to the executed text —
 *    addendum §3.4 coordinate space), startColumn, lineCount, repeatOrdinal.
 */

export interface SqlBatch {
    text: string;
    /** 0-based line offset of the batch's first line within the input. */
    startLine: number;
    /** 0-based column of the batch's first character on its first line. */
    startColumn: number;
    lineCount: number;
    /** 0-based repetition ordinal (GO n emits n entries, same text). */
    repeatOrdinal: number;
    /** Total repetitions declared for this batch (1 unless GO n). */
    repeatTotal: number;
}

interface LexState {
    /** Region kind the scanner is inside at a line start. */
    region: "code" | "blockComment" | "string" | "bracket" | "quotedIdent";
    /** Block comments nest in T-SQL. */
    blockDepth: number;
}

/**
 * Scan one line, updating multi-line region state. Returns the state at the
 * END of the line (line comments never carry across lines).
 */
export function scanLine(line: string, state: LexState): LexState {
    let { region, blockDepth } = state;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        const next = line[i + 1];
        switch (region) {
            case "code":
                if (ch === "-" && next === "-") {
                    return { region: "code", blockDepth: 0 }; // rest is comment
                } else if (ch === "/" && next === "*") {
                    region = "blockComment";
                    blockDepth = 1;
                    i += 2;
                    continue;
                } else if (ch === "'") {
                    region = "string";
                } else if (ch === "[") {
                    region = "bracket";
                } else if (ch === '"') {
                    region = "quotedIdent";
                }
                break;
            case "blockComment":
                if (ch === "/" && next === "*") {
                    blockDepth++;
                    i += 2;
                    continue;
                } else if (ch === "*" && next === "/") {
                    blockDepth--;
                    if (blockDepth === 0) {
                        region = "code";
                    }
                    i += 2;
                    continue;
                }
                break;
            case "string":
                if (ch === "'") {
                    if (next === "'") {
                        i += 2; // escaped quote
                        continue;
                    }
                    region = "code";
                }
                break;
            case "bracket":
                if (ch === "]") {
                    if (next === "]") {
                        i += 2; // escaped ]
                        continue;
                    }
                    region = "code";
                }
                break;
            case "quotedIdent":
                if (ch === '"') {
                    region = "code";
                }
                break;
        }
        i++;
    }
    return { region, blockDepth };
}

const GO_LINE = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i;

/**
 * First lexed keyword of a batch (shared with the DDL sniffer): a character
 * walk that skips whitespace, line comments, and (nested) block comments —
 * including comments that close mid-line before the first token.
 */
export function leadingKeyword(text: string): string | undefined {
    let i = 0;
    let blockDepth = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (blockDepth > 0) {
            if (ch === "/" && next === "*") {
                blockDepth++;
                i += 2;
            } else if (ch === "*" && next === "/") {
                blockDepth--;
                i += 2;
            } else {
                i++;
            }
            continue;
        }
        if (ch === "/" && next === "*") {
            blockDepth = 1;
            i += 2;
            continue;
        }
        if (ch === "-" && next === "-") {
            const eol = text.indexOf("\n", i);
            if (eol < 0) {
                return undefined;
            }
            i = eol + 1;
            continue;
        }
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        const match = /^([A-Za-z_]+)/.exec(text.slice(i));
        return match ? match[1].toUpperCase() : undefined;
    }
    return undefined;
}

export function splitBatches(input: string): SqlBatch[] {
    const lines = input.split(/\r?\n/);
    const batches: SqlBatch[] = [];
    let state: LexState = { region: "code", blockDepth: 0 };
    let currentLines: string[] = [];
    let currentStart = 0;

    const emit = (endLineExclusive: number, repeat: number) => {
        const text = currentLines.join("\n");
        if (text.trim().length > 0) {
            const firstContent = currentLines.findIndex((l) => l.trim().length > 0);
            const startLine = currentStart + Math.max(0, firstContent);
            const startColumn =
                firstContent >= 0
                    ? currentLines[firstContent].length -
                      currentLines[firstContent].trimStart().length
                    : 0;
            for (let ordinal = 0; ordinal < repeat; ordinal++) {
                batches.push({
                    text,
                    startLine,
                    startColumn,
                    lineCount: endLineExclusive - currentStart,
                    repeatOrdinal: ordinal,
                    repeatTotal: repeat,
                });
            }
        }
        currentLines = [];
        currentStart = endLineExclusive + 1;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // A GO separator only counts when the line STARTS in code region.
        if (state.region === "code") {
            const go = GO_LINE.exec(line);
            if (go) {
                const count = go[1] ? Math.max(1, parseInt(go[1], 10)) : 1;
                emit(lineIndex, count);
                continue;
            }
        }
        currentLines.push(line);
        state = scanLine(line, state);
    }
    emit(lines.length, 1);
    return batches;
}

/**
 * Error line mapping (addendum §3.4, binding formula):
 *   documentLine (1-based) = selectionStartLine (1-based)
 *                          + batch.startLine (0-based, executed text)
 *                          + (serverLine − 1)
 * Missing/zero server line → the batch's first line.
 */
export function mapServerLineToDocument(
    selectionStartLine: number,
    batchStartLine: number,
    serverLine: number | undefined,
): number {
    if (!serverLine || serverLine <= 0) {
        return selectionStartLine + batchStartLine;
    }
    return selectionStartLine + batchStartLine + (serverLine - 1);
}
