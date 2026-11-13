/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Detects SQLCMD syntax in a script the same way SQL Tools Service's SqlCmdSyntaxDetector does
 * when it auto-detects SQLCMD mode for an execution, so an editor in SQLCMD mode Auto gets the
 * SQLCMD language flavor exactly when its executions would run in SQLCMD mode.
 */

import { LexState, scanLine } from "./batchSplitter";
import { SQLCMD_DIRECTIVE_HEADS } from "./sqlcmdPreprocessor";

const COMMAND_LINE = /^[ \t]*:(!!|[A-Za-z]+)/;
const ON_ERROR_LINE = /^[ \t]*:on[ \t]+error\b/i;
const LINE_START_COLON = /^[ \t]*:/m;
const IDENTIFIER_START_CHAR = /[\p{L}_]/u;
const IDENTIFIER_CHAR = /[\p{L}\p{Nd}_-]/u;

/**
 * Returns true if the script contains a SQLCMD command (such as `:setvar`, `:r`, `:on error`,
 * `:connect` or `:!!`) as the first non-whitespace text on a line, or a `$(variable)` reference,
 * outside of string literals and comments. Variable references inside bracketed and double-quoted
 * identifiers count, since they commonly hold them (for example `USE [$(DatabaseName)]`).
 * @param script the script text to inspect
 */
export function containsSqlCmdSyntax(script: string): boolean {
    if (!mayContainSqlCmdSyntax(script)) {
        return false;
    }

    let state: LexState = { region: "code", blockDepth: 0 };
    for (const line of script.split("\n")) {
        if (state.region === "code" && isCommandLine(line)) {
            return true;
        }
        let hasVariableReference = false;
        state = scanLine(line, state, (index, region) => {
            if (
                !hasVariableReference &&
                region !== "string" &&
                region !== "blockComment" &&
                isVariableReferenceAt(line, index)
            ) {
                hasVariableReference = true;
            }
        });
        if (hasVariableReference) {
            return true;
        }
    }
    return false;
}

/**
 * Cheap pre-check that avoids scanning scripts that can't contain SQLCMD syntax: commands need a
 * colon as the first non-whitespace character on a line, and variable references contain `$(`.
 */
function mayContainSqlCmdSyntax(script: string): boolean {
    return script.includes("$(") || LINE_START_COLON.test(script);
}

function isCommandLine(line: string): boolean {
    const match = COMMAND_LINE.exec(line);
    if (!match) {
        return false;
    }
    const head = match[1].toLowerCase();
    if (head === "on") {
        return ON_ERROR_LINE.test(line);
    }
    return head === "!!" || SQLCMD_DIRECTIVE_HEADS.has(head);
}

function isVariableReferenceAt(line: string, index: number): boolean {
    if (
        line[index] !== "$" ||
        line[index + 1] !== "(" ||
        !IDENTIFIER_START_CHAR.test(line[index + 2] ?? "")
    ) {
        return false;
    }
    for (let i = index + 3; i < line.length; i++) {
        if (line[i] === ")") {
            return true;
        }
        if (!IDENTIFIER_CHAR.test(line[i])) {
            return false;
        }
    }
    return false;
}
