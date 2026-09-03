/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../../text/index.js";
import type { SyntaxDiagnostic } from "../contracts.js";
import { codeMask, statementEndOffset } from "./syntaxDiagnosticUtilities.js";

export interface PrincipalOptionSyntaxDiagnosticReplacement {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly recoveryRange: TextRange;
}

const stringLiteral = String.raw`(?:N)?'(?:''|[^'])*'`;
const binaryLiteral = String.raw`0[xX][0-9a-fA-F]*`;
const identifier = String.raw`(?:\[[^\]]*\]|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
const number = String.raw`\d+(?:\.\d+)?`;

/** Option words whose value shape the product checks before it accepts the option at all. */
const valueShapes = new Map<string, RegExp>([
    ["PASSWORD", new RegExp(`^(?:${stringLiteral}|${binaryLiteral})$`, "u")],
    ["SID", new RegExp(`^${binaryLiteral}$`, "u")],
    ["ALLOW_ENCRYPTED_VALUE_MODIFICATIONS", /^(?:ON|OFF)$/iu],
]);

/** Option words that are reported at the option itself rather than at the value it was given. */
const reportedAtName = new Set(["ALLOW_ENCRYPTED_VALUE_MODIFICATIONS", "SID"]);

/**
 * CREATE USER carries a comma-separated option list whose words appear once each and whose values
 * have fixed shapes. One rejected option ends the list in the parser, so only the first is
 * reported and the recovery nodes it leaves behind are replaced.
 */
export function invalidPrincipalOptionDiagnostics(
    text: string,
): readonly PrincipalOptionSyntaxDiagnosticReplacement[] {
    if (!/\bCREATE\s+USER\b/iu.test(text)) return [];
    const code = codeMask(text);
    const result: PrincipalOptionSyntaxDiagnosticReplacement[] = [];
    const header = new RegExp(
        String.raw`\bCREATE\s+USER\s+${identifier}(?:\s+(?:FOR|FROM|WITHOUT)\s+[^,;]*?)?\s+WITH\s`,
        "giu",
    );
    for (const match of code.matchAll(header)) {
        const from = match.index + match[0].length;
        const end = statementEndOffset(code, from);
        const diagnostic = firstOptionDiagnostic(text, code, from, end);
        if (diagnostic)
            result.push({ diagnostics: [diagnostic], recoveryRange: { start: from, end } });
    }
    return result;
}

function firstOptionDiagnostic(
    text: string,
    code: string,
    from: number,
    end: number,
): SyntaxDiagnostic | undefined {
    const option = new RegExp(
        String.raw`(?<name>${identifier})\s*=\s*(?<value>${stringLiteral}|${binaryLiteral}|${number}|${identifier})`,
        "giu",
    );
    const seen = new Set<string>();
    for (const match of code.slice(from, end).matchAll(option)) {
        const start = from + match.index;
        const name = match.groups!.name!;
        const value = match.groups!.value!;
        const valueStart = start + match[0].length - value.length;
        const word = name.toUpperCase();
        if (seen.has(word)) {
            return near(text, { start: valueStart, end: valueStart + value.length });
        }
        seen.add(word);
        const shape = valueShapes.get(word);
        if (!shape || shape.test(text.slice(valueStart, valueStart + value.length))) continue;
        return reportedAtName.has(word)
            ? near(text, { start, end: start + name.length })
            : near(
                  text,
                  { start: valueStart, end: valueStart + value.length },
                  "STRING, or TEXT_LEX",
              );
    }
    return undefined;
}

function near(text: string, range: TextRange, expected?: string): SyntaxDiagnostic {
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.start, range.end)}'.${
            expected ? `  Expecting ${expected}.` : ""
        }`,
        severity: "error",
        range,
    };
}
