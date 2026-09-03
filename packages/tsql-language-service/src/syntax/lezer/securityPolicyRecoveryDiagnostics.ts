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

export interface SecurityPolicySyntaxDiagnosticReplacement {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly recoveryRange: TextRange;
}

const identifier = String.raw`(?:\[[^\]]*\]|"[^"]*"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
const multipart = String.raw`${identifier}(?:\s*\.\s*${identifier})*`;

const predicateKindExpectation = "NOT_FOR, SP_BLOCK, or SP_FILTER";
const addStatementExpectation = "ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE";
const groupedQueryExpectation = "'(', or SELECT";

/**
 * A security policy is a list of predicate actions with a fixed vocabulary. One misplaced word ends
 * the statement in the parser, so recovery would otherwise report every remaining token. Each shape
 * below reports the word that actually broke, plus the words the statement's own recovery then
 * reads as the start of something else, and suppresses the rest.
 */
export function securityPolicyRecoveryDiagnostics(
    text: string,
): readonly SecurityPolicySyntaxDiagnosticReplacement[] {
    if (!/\bSECURITY\s+POLICY\b/iu.test(text)) return [];
    const code = codeMask(text);
    const result: SecurityPolicySyntaxDiagnosticReplacement[] = [];
    const header = new RegExp(
        String.raw`\b(?:CREATE|ALTER)\s+SECURITY\s+POLICY\s+${multipart}`,
        "giu",
    );
    for (const match of code.matchAll(header)) {
        const bodyStart = match.index + match[0].length;
        const end = statementEndOffset(code, bodyStart);
        const replacement =
            predicateActionDiagnostics(text, code, bodyStart, end) ??
            policyOptionDiagnostics(text, code, bodyStart, end) ??
            replicationClauseDiagnostics(text, code, bodyStart, end);
        if (replacement) result.push(replacement);
    }
    return result;
}

/** Reports the first predicate action the policy vocabulary cannot place. */
function predicateActionDiagnostics(
    text: string,
    code: string,
    from: number,
    end: number,
): SecurityPolicySyntaxDiagnosticReplacement | undefined {
    const body = code.slice(from, end);
    const kind = new RegExp(
        String.raw`\b(?:ADD|ALTER|DROP)\s+(?!FILTER\b|BLOCK\b|NOT\b)(?<word>${identifier})\s+PREDICATE\b`,
        "iu",
    ).exec(body);
    if (kind) {
        const start = from + kind.index + kind[0].indexOf(kind.groups!.word!);
        return replacement(
            [
                near(text, start, kind.groups!.word!.length, predicateKindExpectation),
                ...callArgumentCascade(text, code, start, end),
            ],
            start,
            end,
        );
    }

    const dropTarget = new RegExp(
        String.raw`\bDROP\s+(?:FILTER|BLOCK)\s+PREDICATE\s+(?!ON\b)(?<word>${identifier})`,
        "iu",
    ).exec(body);
    if (dropTarget) {
        const start = from + dropTarget.index + dropTarget[0].indexOf(dropTarget.groups!.word!);
        return replacement(
            [
                near(text, start, dropTarget.groups!.word!.length, "ON"),
                ...callArgumentCascade(text, code, start, end),
            ],
            start,
            end,
        );
    }

    const unclosed = new RegExp(String.raw`\bPREDICATE\s+${multipart}\s*(?<open>\()`, "giu");
    for (const call of body.matchAll(unclosed)) {
        const open = from + call.index + call[0].length - 1;
        if (matchingCloseParenOffset(code, open, end) >= 0) continue;
        const on = /\bON\b/iu.exec(code.slice(open, end));
        if (!on) continue;
        const start = open + on.index;
        return replacement([near(text, start, on[0].length)], start, end);
    }

    const missingOn = new RegExp(
        String.raw`\bPREDICATE\s+${multipart}\s*\([^()]*\)\s+(?!ON\b|AFTER\b|BEFORE\b)(?<word>${identifier})`,
        "iu",
    ).exec(body);
    if (missingOn) {
        const start = from + missingOn.index + missingOn[0].lastIndexOf(missingOn.groups!.word!);
        const diagnostics = [near(text, start, missingOn.groups!.word!.length, "ON")];
        const nextAction = /,\s*(?<word>ADD|ALTER|DROP)\b/iu.exec(code.slice(start, end));
        if (nextAction) {
            const actionStart =
                start + nextAction.index + nextAction[0].indexOf(nextAction.groups!.word!);
            diagnostics.push(near(text, actionStart, nextAction.groups!.word!.length));
        }
        return replacement(diagnostics, start, end);
    }

    const missingComma = new RegExp(
        String.raw`\bON\s+${multipart}(?:\s+(?:AFTER|BEFORE)\s+(?:INSERT|UPDATE|DELETE))?\s+ADD\s+(?<word>${identifier})`,
        "iu",
    ).exec(body);
    if (missingComma) {
        const start =
            from + missingComma.index + missingComma[0].lastIndexOf(missingComma.groups!.word!);
        return replacement(
            [
                near(text, start, missingComma.groups!.word!.length, addStatementExpectation),
                ...callArgumentCascade(text, code, start, end),
            ],
            start,
            end,
        );
    }
    return undefined;
}

/**
 * Once the statement has failed, the parenthesized predicate arguments that follow are read as a
 * parenthesized query, so the first word inside them is reported too.
 */
function callArgumentCascade(
    text: string,
    code: string,
    from: number,
    end: number,
): readonly SyntaxDiagnostic[] {
    const call = new RegExp(String.raw`${identifier}\s*\(\s*(?<first>${identifier})`, "iu").exec(
        code.slice(from, end),
    );
    if (!call) return [];
    const start = from + call.index + call[0].length - call.groups!.first!.length;
    return [near(text, start, call.groups!.first!.length, groupedQueryExpectation)];
}

/** The policy state options are switches, so a value that is neither ON nor OFF is reported. */
function policyOptionDiagnostics(
    text: string,
    code: string,
    from: number,
    end: number,
): SecurityPolicySyntaxDiagnosticReplacement | undefined {
    const option = new RegExp(
        String.raw`\b(?:STATE|SCHEMABINDING)\s*=\s*(?<value>${identifier}|\d+(?:\.\d+)?)`,
        "giu",
    );
    for (const match of code.slice(from, end).matchAll(option)) {
        const value = match.groups!.value!;
        if (/^(?:ON|OFF)$/iu.test(value)) continue;
        const start = from + match.index + match[0].length - value.length;
        return replacement(
            [near(text, start, value.length, "OFF, or ON")],
            start,
            start + value.length,
        );
    }
    return undefined;
}

/** NOT FOR takes one word, so a misspelling of it is reported against the word itself. */
function replicationClauseDiagnostics(
    text: string,
    code: string,
    from: number,
    end: number,
): SecurityPolicySyntaxDiagnosticReplacement | undefined {
    const match = new RegExp(
        String.raw`\bNOT\s+FOR\s+(?!REPLICATION\b)(?<word>${identifier})`,
        "iu",
    ).exec(code.slice(from, end));
    if (!match) return undefined;
    const start = from + match.index + match[0].lastIndexOf(match.groups!.word!);
    return replacement([near(text, start, match.groups!.word!.length, "REPLICATION")], start, end);
}

function replacement(
    diagnostics: readonly SyntaxDiagnostic[],
    start: number,
    end: number,
): SecurityPolicySyntaxDiagnosticReplacement {
    return { diagnostics, recoveryRange: { start, end } };
}

function near(text: string, start: number, length: number, expected?: string): SyntaxDiagnostic {
    const range = { start, end: start + length };
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.start, range.end)}'.${
            expected ? `  Expecting ${expected}.` : ""
        }`,
        severity: "error",
        range,
    };
}
