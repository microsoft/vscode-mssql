/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SqlBatchRegion {
    readonly text: string;
    readonly start: number;
    readonly end: number;
    /** One-based source line for the first character in this region. */
    readonly startLine: number;
    readonly separator?: {
        readonly start: number;
        readonly end: number;
        readonly text: string;
        readonly count?: number;
    };
}

/**
 * Splits SQLCMD batches conservatively. A GO is accepted only when it is the sole code token on a
 * line. When lexical state is uncertain (for example, an unterminated string), the remainder stays
 * in the same batch so incrementality can never change parser correctness.
 */
export function partitionSqlBatches(text: string): readonly SqlBatchRegion[] {
    const batches: SqlBatchRegion[] = [];
    let batchStart = 0;
    let batchStartLine = 1;
    let lineStart = 0;
    let lineNumber = 1;
    let state: ScanState = { kind: "code", blockDepth: 0 };

    while (lineStart < text.length) {
        const newline = text.indexOf("\n", lineStart);
        const lineEnd = newline < 0 ? text.length : newline;
        const lineEndWithNewline = newline < 0 ? lineEnd : lineEnd + 1;
        const scan = scanLine(text.slice(lineStart, lineEnd), state);
        state = scan.state;
        const match = state.kind === "code" ? /^\s*GO(?:\s+(\d+))?\s*$/iu.exec(scan.code) : null;
        if (match) {
            const leadingWhitespace = /^\s*/u.exec(scan.code)?.[0].length ?? 0;
            const separatorStart = lineStart + leadingWhitespace;
            batches.push({
                text: text.slice(batchStart, lineStart),
                start: batchStart,
                end: lineStart,
                startLine: batchStartLine,
                separator: {
                    start: separatorStart,
                    end: lineEnd,
                    text: text.slice(lineStart, lineEndWithNewline),
                    count: match[1] ? Number.parseInt(match[1], 10) : undefined,
                },
            });
            batchStart = lineEndWithNewline;
            batchStartLine = lineNumber + 1;
        }
        lineStart = lineEndWithNewline;
        lineNumber++;
    }

    batches.push({
        text: text.slice(batchStart),
        start: batchStart,
        end: text.length,
        startLine: batchStartLine,
    });
    return batches;
}

type ScanState =
    | { readonly kind: "code"; readonly blockDepth: 0 }
    | { readonly kind: "blockComment"; readonly blockDepth: number }
    | { readonly kind: "singleQuote"; readonly blockDepth: 0 }
    | { readonly kind: "doubleQuote"; readonly blockDepth: 0 }
    | { readonly kind: "bracket"; readonly blockDepth: 0 };

function scanLine(
    line: string,
    initial: ScanState,
): { readonly code: string; readonly state: ScanState } {
    let state = initial;
    // Keeping the masked text the same length as the source makes offsets exact even when a line
    // begins inside a multi-line comment or contains quoted/commented text before GO.
    const code = Array.from<string>({ length: line.length }).fill(" ");

    for (let index = 0; index < line.length; index++) {
        const character = line[index]!;
        const next = line[index + 1];
        if (state.kind === "blockComment") {
            if (character === "/" && next === "*") {
                state = { kind: "blockComment", blockDepth: state.blockDepth + 1 };
                index++;
            } else if (character === "*" && next === "/") {
                const depth = state.blockDepth - 1;
                state =
                    depth === 0
                        ? { kind: "code", blockDepth: 0 }
                        : { kind: "blockComment", blockDepth: depth };
                index++;
            }
            continue;
        }
        if (state.kind === "singleQuote" || state.kind === "doubleQuote") {
            const quote = state.kind === "singleQuote" ? "'" : '"';
            if (character === quote) {
                if (next === quote) {
                    index++;
                } else {
                    state = { kind: "code", blockDepth: 0 };
                }
            }
            continue;
        }
        if (state.kind === "bracket") {
            if (character === "]") {
                if (next === "]") {
                    index++;
                } else {
                    state = { kind: "code", blockDepth: 0 };
                }
            }
            continue;
        }

        if (character === "-" && next === "-") {
            break;
        }
        if (character === "/" && next === "*") {
            state = { kind: "blockComment", blockDepth: 1 };
            index++;
        } else if (character === "'") {
            state = { kind: "singleQuote", blockDepth: 0 };
        } else if (character === '"') {
            state = { kind: "doubleQuote", blockDepth: 0 };
        } else if (character === "[") {
            state = { kind: "bracket", blockDepth: 0 };
        } else {
            code[index] = character;
        }
    }

    return { code: code.join(""), state };
}
