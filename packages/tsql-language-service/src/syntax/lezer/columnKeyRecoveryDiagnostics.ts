/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../../text/index.js";
import type { SyntaxDiagnostic } from "../contracts.js";
import {
    codeMask,
    matchingCloseParenOffset,
    statementEndOffset,
} from "./syntaxDiagnosticUtilities.js";

export interface ColumnKeySyntaxDiagnosticReplacement {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly recoveryRange: TextRange;
}

const stringLiteral = String.raw`(?:N)?'(?:''|[^'])*'`;
const identifier = String.raw`(?:\[[^\]]*\]|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
const masterKeyName = String.raw`COLUMN_MASTER_KEY|COLUMN\s+MASTER\s+KEY\s+DEFINITION`;

const identifierExpectation = "ID, or QUOTED_ID";
const addStatementExpectation = "ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE";
const groupedQueryExpectation = "'(', or SELECT";

/**
 * Column key statements name their key with an identifier and carry a fixed option list. Recovery
 * from a misspelled name or option would otherwise scatter one mistake over the whole statement, so
 * the shapes below are recognized directly and replace the recovery nodes they cover.
 *
 * Scanning runs over a masked copy in which comment bodies and string contents are blank, so an
 * option word written inside a comment or a literal never starts a match.
 */
export function invalidColumnKeyDiagnostics(
    text: string,
): readonly ColumnKeySyntaxDiagnosticReplacement[] {
    if (!/\bCOLUMN\s+(?:ENCRYPTION|MASTER)\s+KEY\b/iu.test(text)) return [];
    const code = codeMask(text);
    return [
        ...quotedKeyNameDiagnostics(text, code),
        ...keyValueListDiagnostics(text, code),
        ...masterKeyOptionDiagnostics(text, code),
    ];
}

/**
 * A key name is an identifier. A quoted one is reported where it stands, and for ALTER the words
 * after it are then read as a fresh ADD statement, which reports the two words it cannot place.
 */
function quotedKeyNameDiagnostics(
    text: string,
    code: string,
): readonly ColumnKeySyntaxDiagnosticReplacement[] {
    const result: ColumnKeySyntaxDiagnosticReplacement[] = [];
    const pattern = new RegExp(
        String.raw`\b(?<verb>ALTER|DROP)\s+COLUMN\s+(?:ENCRYPTION|MASTER)\s+KEY\s+(?:DEFINITION\s+)?(?<name>${stringLiteral})`,
        "giu",
    );
    for (const match of code.matchAll(pattern)) {
        const name = match.groups!.name!;
        const start = match.index + match[0].length - name.length;
        const diagnostics = [
            syntaxDiagnostic(text, { start, end: start + name.length }, identifierExpectation),
        ];
        const end = statementEndOffset(code, start);
        if (match.groups!.verb!.toUpperCase() === "ALTER") {
            diagnostics.push(...addStatementCascade(text, code, start + name.length, end));
        }
        result.push({ diagnostics, recoveryRange: { start, end } });
    }
    return result;
}

/** The ADD of ALTER ... ADD VALUE reads as an ADD statement once its own statement has failed. */
function addStatementCascade(
    text: string,
    code: string,
    from: number,
    limit: number,
): readonly SyntaxDiagnostic[] {
    const add = new RegExp(String.raw`\bADD\s+(?<word>${identifier})`, "iu").exec(
        code.slice(from, limit),
    );
    if (!add) return [];
    const word = add.groups!.word!;
    const wordStart = from + add.index + add[0].length - word.length;
    const result = [
        syntaxDiagnostic(
            text,
            { start: wordStart, end: wordStart + word.length },
            addStatementExpectation,
        ),
    ];
    const open = new RegExp(String.raw`^\s*\(\s*(?<first>${identifier})`, "iu").exec(
        code.slice(wordStart + word.length, limit),
    );
    if (open) {
        const first = open.groups!.first!;
        const firstStart = wordStart + word.length + open[0].length - first.length;
        result.push(
            syntaxDiagnostic(
                text,
                { start: firstStart, end: firstStart + first.length },
                groupedQueryExpectation,
            ),
        );
    }
    return result;
}

/** Validates the option list of ALTER COLUMN ENCRYPTION KEY ADD VALUE and DROP VALUE. */
function keyValueListDiagnostics(
    text: string,
    code: string,
): readonly ColumnKeySyntaxDiagnosticReplacement[] {
    const result: ColumnKeySyntaxDiagnosticReplacement[] = [];
    const pattern = new RegExp(
        String.raw`\bALTER\s+COLUMN\s+ENCRYPTION\s+KEY\s+${identifier}\s+(?<verb>ADD|DROP)\s+VALUE\s*(?<open>\()`,
        "giu",
    );
    for (const match of code.matchAll(pattern)) {
        const open = match.index + match[0].length - 1;
        const dropValue = match.groups!.verb!.toUpperCase() === "DROP";
        const close = matchingCloseParenOffset(code, open);
        const limit = close < 0 ? statementEndOffset(code, open) : close;
        const diagnostic =
            firstValueOptionDiagnostic(text, code, open + 1, limit, dropValue) ??
            (close < 0
                ? syntaxDiagnostic(
                      text,
                      { start: limit, end: limit },
                      dropValue ? "')'" : "')', or ','",
                  )
                : undefined);
        if (!diagnostic) continue;
        result.push({
            diagnostics: [diagnostic],
            recoveryRange: { start: open, end: close < 0 ? limit : close + 1 },
        });
    }
    return result;
}

/**
 * The first option the list cannot accept ends its analysis: everything after it belongs to the
 * same recovery, so a second report would restate one mistake.
 */
function firstValueOptionDiagnostic(
    text: string,
    code: string,
    from: number,
    limit: number,
    dropValue: boolean,
): SyntaxDiagnostic | undefined {
    const option = new RegExp(
        String.raw`(?<name>${masterKeyName}|ALGORITHM|ENCRYPTED_VALUE)\s*=\s*(?<value>${stringLiteral}|0[xX][0-9a-fA-F]+|${identifier})`,
        "giu",
    );
    let previousEnd: number | undefined;
    for (const match of code.slice(from, limit).matchAll(option)) {
        const start = from + match.index;
        const name = match.groups!.name!;
        const value = match.groups!.value!;
        if (previousEnd !== undefined && !/^[\s,]*,/u.test(code.slice(previousEnd, start))) {
            return syntaxDiagnostic(
                text,
                { start, end: start + name.length },
                dropValue ? "')'" : "')', or ','",
            );
        }
        previousEnd = start + match[0].length;
        if (!/^COLUMN/iu.test(name)) continue;
        if (dropValue && /\s/u.test(name)) {
            return syntaxDiagnostic(
                text,
                { start, end: start + "COLUMN".length },
                "CEMK_COL_MASTER_KEY",
            );
        }
        if (value.endsWith("'")) {
            const valueStart = start + match[0].length - value.length;
            return syntaxDiagnostic(
                text,
                { start: valueStart, end: valueStart + value.length },
                identifierExpectation,
            );
        }
    }
    return undefined;
}

/** Validates the two-option WITH list of CREATE COLUMN MASTER KEY. */
function masterKeyOptionDiagnostics(
    text: string,
    code: string,
): readonly ColumnKeySyntaxDiagnosticReplacement[] {
    const result: ColumnKeySyntaxDiagnosticReplacement[] = [];
    const pattern = new RegExp(
        String.raw`\bCREATE\s+COLUMN\s+MASTER\s+KEY\s+(?:DEFINITION\s+)?${identifier}\s+WITH\s*(?<open>\()`,
        "giu",
    );
    for (const match of code.matchAll(pattern)) {
        const open = match.index + match[0].length - 1;
        const close = matchingCloseParenOffset(code, open);
        const limit = close < 0 ? statementEndOffset(code, open) : close;
        const diagnostic =
            firstMasterKeyOptionDiagnostic(text, code, open + 1, limit) ??
            (close < 0
                ? syntaxDiagnostic(text, { start: limit, end: limit }, "')', or ','")
                : undefined);
        if (!diagnostic) continue;
        result.push({
            diagnostics: [diagnostic],
            recoveryRange: { start: open, end: close < 0 ? limit : close + 1 },
        });
    }
    return result;
}

function firstMasterKeyOptionDiagnostic(
    text: string,
    code: string,
    from: number,
    limit: number,
): SyntaxDiagnostic | undefined {
    const option = new RegExp(
        String.raw`(?<name>KEY_STORE_PROVIDER_NAME|KEY_PATH|ENCLAVE_COMPUTATIONS)\s*=\s*(?<value>${stringLiteral}|${identifier})`,
        "giu",
    );
    let previousEnd: number | undefined;
    for (const match of code.slice(from, limit).matchAll(option)) {
        const start = from + match.index;
        const name = match.groups!.name!;
        const value = match.groups!.value!;
        if (previousEnd !== undefined && !/^[\s,]*,/u.test(code.slice(previousEnd, start))) {
            return syntaxDiagnostic(text, { start, end: start + name.length }, "','");
        }
        previousEnd = start + match[0].length;
        if (name.toUpperCase() === "ENCLAVE_COMPUTATIONS" || value.endsWith("'")) continue;
        const valueStart = start + match[0].length - value.length;
        return syntaxDiagnostic(
            text,
            { start: valueStart, end: valueStart + value.length },
            "STRING, or TEXT_LEX",
        );
    }
    return undefined;
}

function syntaxDiagnostic(text: string, range: TextRange, expected?: string): SyntaxDiagnostic {
    const near = range.start === text.length ? "End Of File" : text.slice(range.start, range.end);
    return {
        code: "syntax",
        message: `Incorrect syntax near '${near}'.${expected ? `  Expecting ${expected}.` : ""}`,
        severity: "error",
        range,
    };
}
