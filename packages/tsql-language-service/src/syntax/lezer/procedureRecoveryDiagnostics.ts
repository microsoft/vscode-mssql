/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../../text/index.js";
import type { SyntaxDiagnostic } from "../contracts.js";

export interface ProcedureSyntaxDiagnosticReplacement {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly recoveryRange: TextRange;
}

interface Word extends TextRange {
    readonly text: string;
    readonly depth: number;
}

const dataTypeExpectation = "AS, CURSOR, DOUBLE, ID, NATIONAL, or QUOTED_ID";
const parameterContinuationExpectation = "')', ',', AS, FOR, or WITH";

/** Adds stable recovery diagnostics for malformed procedure headers and grouped query bodies. */
export function procedureRecoveryDiagnostics(
    text: string,
): readonly ProcedureSyntaxDiagnosticReplacement[] {
    const words = scanWords(text);
    const result: ProcedureSyntaxDiagnosticReplacement[] = [];
    const procedures = findProcedureStarts(words);
    for (const [procedureIndex, procedure] of procedures.entries()) {
        const nextProcedure = procedures[procedureIndex + 1];
        const wordLimit = nextProcedure?.wordIndex ?? words.length;
        const textLimit = nextProcedure?.start ?? text.length;
        const moduleAs = findModuleAs(words, procedure.wordIndex + 1, wordLimit);
        if (!moduleAs) continue;

        const header = { start: procedure.start, end: moduleAs.start };
        const parameterOpen = text.indexOf("(", procedure.end);
        if (parameterOpen >= 0 && parameterOpen < moduleAs.start) {
            const parameterClose = matchingCloseParen(text, parameterOpen, moduleAs.start);
            if (parameterClose >= 0) {
                result.push(...parameterListDiagnostics(text, parameterOpen, parameterClose));
            }
        }
        result.push(...procedureOptionDiagnostics(text, header));

        const bodyStart = skipTrivia(text, moduleAs.end, textLimit);
        if (bodyStart === text.length || bodyStart === textLimit) {
            result.push({
                diagnostics: [],
                recoveryRange: { start: moduleAs.start, end: bodyStart },
            });
            continue;
        }
        if (text[bodyStart] !== "(") continue;
        const bodyClose = matchingCloseParen(text, bodyStart, textLimit);
        if (bodyClose < 0) continue;
        const bodyContent = text.slice(bodyStart + 1, bodyClose);
        const firstContent = skipTrivia(text, bodyStart + 1, bodyClose);
        const trimmedBody = bodyContent.trim();
        if (trimmedBody === "" || trimmedBody === ";") {
            const near = trimmedBody === ";" ? firstContent : bodyClose;
            result.push({
                diagnostics: [
                    syntaxDiagnostic(text, { start: near, end: near + 1 }, "'(', or SELECT"),
                ],
                recoveryRange: { start: bodyStart, end: bodyClose + 1 },
            });
            continue;
        }

        const bodyWords = scanWords(text, bodyStart + 1, bodyClose).filter(
            ({ depth }) => depth === 0,
        );
        const selects = bodyWords.filter(({ text: value }) => value === "select");
        if (selects.length > 1) {
            const second = selects[1]!;
            result.push({
                diagnostics: [
                    syntaxDiagnostic(text, second, "')', EXCEPT, or UNION"),
                    syntaxDiagnostic(text, { start: bodyClose, end: bodyClose + 1 }),
                ],
                recoveryRange: { start: second.start, end: bodyClose + 1 },
            });
        }
    }
    return result;
}

function parameterListDiagnostics(
    text: string,
    open: number,
    close: number,
): readonly ProcedureSyntaxDiagnosticReplacement[] {
    const result: ProcedureSyntaxDiagnosticReplacement[] = [];
    const segments = topLevelSegments(text, open + 1, close);
    if (segments.length === 1 && text.slice(segments[0]!.start, segments[0]!.end).trim() === "") {
        return [
            {
                diagnostics: [syntaxDiagnostic(text, { start: close, end: close + 1 }, "VARIABLE")],
                recoveryRange: { start: open, end: close + 1 },
            },
        ];
    }

    for (const [index, segment] of segments.entries()) {
        const start = skipTrivia(text, segment.start, segment.end);
        const end = trimTriviaEnd(text, start, segment.end);
        if (start === end) {
            if (index === segments.length - 1) {
                result.push({
                    diagnostics: [
                        syntaxDiagnostic(text, { start: close, end: close + 1 }, "VARIABLE"),
                    ],
                    recoveryRange: { start: segment.start - 1, end: close + 1 },
                });
            }
            continue;
        }
        const source = text.slice(start, end);
        const variable = /^@[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(source);
        if (!variable) {
            const name = /^[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(source);
            if (name) {
                result.push({
                    diagnostics: [
                        syntaxDiagnostic(text, { start, end: start + name[0].length }, "VARIABLE"),
                    ],
                    recoveryRange: { start, end },
                });
            }
            continue;
        }
        const afterVariable = skipTrivia(text, start + variable[0].length, end);
        if (afterVariable === end) {
            const near = index === segments.length - 1 ? close : segment.end;
            result.push({
                diagnostics: [
                    syntaxDiagnostic(text, { start: near, end: near + 1 }, dataTypeExpectation),
                ],
                recoveryRange: { start: afterVariable, end: near + 1 },
            });
            continue;
        }
        if (text[afterVariable] === "=") {
            result.push({
                diagnostics: [
                    syntaxDiagnostic(
                        text,
                        { start: afterVariable, end: afterVariable + 1 },
                        dataTypeExpectation,
                    ),
                ],
                recoveryRange: { start: afterVariable, end },
            });
            continue;
        }
        const options = scanWords(text, afterVariable, end).filter(({ depth }) => depth === 0);
        for (let optionIndex = 1; optionIndex < options.length; optionIndex++) {
            const previous = options[optionIndex - 1]!;
            const current = options[optionIndex]!;
            if (isParameterOption(previous.text) && isParameterOption(current.text)) {
                result.push({
                    diagnostics: [
                        syntaxDiagnostic(text, current, parameterContinuationExpectation),
                    ],
                    recoveryRange: current,
                });
                break;
            }
        }
    }
    return result;
}

function procedureOptionDiagnostics(
    text: string,
    header: TextRange,
): readonly ProcedureSyntaxDiagnosticReplacement[] {
    const source = text.slice(header.start, header.end);
    const malformed =
        /\bWITH\s+(?:ENCRYPTION|RECOMPILE|SCHEMABINDING|NATIVE_COMPILATION)\s+(?<option>[\p{L}_][\p{L}\p{N}_$#@]*)\s*$/iu.exec(
            source,
        );
    const option = malformed?.groups?.option;
    if (!malformed || !option) return [];
    const start = header.start + malformed.index + malformed[0].lastIndexOf(option);
    return [
        {
            diagnostics: [
                syntaxDiagnostic(text, { start, end: start + option.length }, "AS, or FOR"),
            ],
            recoveryRange: { start, end: start + option.length },
        },
    ];
}

function findProcedureStarts(
    words: readonly Word[],
): readonly { start: number; end: number; wordIndex: number }[] {
    const result: { start: number; end: number; wordIndex: number }[] = [];
    for (let index = 0; index < words.length; index++) {
        const word = words[index]!;
        if (word.depth !== 0 || (word.text !== "create" && word.text !== "alter")) continue;
        let candidate = index + 1;
        if (
            word.text === "create" &&
            words[candidate]?.text === "or" &&
            words[candidate + 1]?.text === "alter"
        ) {
            candidate += 2;
        }
        const kind = words[candidate];
        if (kind?.depth === 0 && (kind.text === "proc" || kind.text === "procedure")) {
            result.push({ start: word.start, end: kind.end, wordIndex: candidate });
            index = candidate;
        }
    }
    return result;
}

function findModuleAs(words: readonly Word[], start: number, end: number): Word | undefined {
    let previous: Word | undefined;
    for (let index = start; index < end; index++) {
        const word = words[index]!;
        if (word.depth !== 0) continue;
        if (word.text === "as" && previous?.text !== "execute") return word;
        previous = word;
    }
    return undefined;
}

function isParameterOption(word: string): boolean {
    return word === "out" || word === "output" || word === "readonly";
}

function syntaxDiagnostic(text: string, range: TextRange, expected?: string): SyntaxDiagnostic {
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.start, range.end)}'.${expected ? `  Expecting ${expected}.` : ""}`,
        severity: "error",
        range,
    };
}

function topLevelSegments(text: string, start: number, end: number): readonly TextRange[] {
    const result: TextRange[] = [];
    let segmentStart = start;
    let depth = 0;
    for (let index = start; index < end; index++) {
        const character = text[index];
        if (character === "'" || character === '"' || character === "[") {
            index = quotedEnd(text, index, end) - 1;
        } else if (character === "(") {
            depth++;
        } else if (character === ")") {
            depth = Math.max(0, depth - 1);
        } else if (character === "," && depth === 0) {
            result.push({ start: segmentStart, end: index });
            segmentStart = index + 1;
        }
    }
    result.push({ start: segmentStart, end });
    return result;
}

function matchingCloseParen(text: string, open: number, limit: number): number {
    let depth = 0;
    for (let index = open; index < limit; index++) {
        const character = text[index];
        if (character === "'" || character === '"' || character === "[") {
            index = quotedEnd(text, index, limit) - 1;
        } else if (character === "(") {
            depth++;
        } else if (character === ")" && --depth === 0) {
            return index;
        }
    }
    return -1;
}

function scanWords(text: string, start = 0, end = text.length): readonly Word[] {
    const result: Word[] = [];
    let depth = 0;
    for (let index = start; index < end; ) {
        const character = text[index]!;
        if (character === "'" || character === '"' || character === "[") {
            index = quotedEnd(text, index, end);
            continue;
        }
        if (character === "-" && text[index + 1] === "-") {
            const newline = text.indexOf("\n", index + 2);
            index = newline < 0 || newline >= end ? end : newline + 1;
            continue;
        }
        if (character === "/" && text[index + 1] === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close < 0 || close + 2 >= end ? end : close + 2;
            continue;
        }
        if (character === "(") {
            depth++;
            index++;
            continue;
        }
        if (character === ")") {
            depth = Math.max(0, depth - 1);
            index++;
            continue;
        }
        if (!/[\p{L}_]/u.test(character)) {
            index++;
            continue;
        }
        const wordStart = index++;
        while (index < end && /[\p{L}\p{N}_$#@]/u.test(text[index]!)) index++;
        result.push({
            text: text.slice(wordStart, index).toLowerCase(),
            start: wordStart,
            end: index,
            depth,
        });
    }
    return result;
}

function quotedEnd(text: string, start: number, end: number): number {
    const open = text[start]!;
    const close = open === "[" ? "]" : open;
    for (let index = start + 1; index < end; index++) {
        if (text[index] !== close) continue;
        if (text[index + 1] === close) index++;
        else return index + 1;
    }
    return end;
}

function skipTrivia(text: string, start: number, end = text.length): number {
    let index = start;
    while (index < end && /\s/u.test(text[index]!)) index++;
    return index;
}

function trimTriviaEnd(text: string, start: number, end: number): number {
    let index = end;
    while (index > start && /\s/u.test(text[index - 1]!)) index--;
    return index;
}
