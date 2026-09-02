/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier, tsqlIdentifierPattern } from "../identifiers.js";
import { containsSyntaxError, directChildrenOfKind } from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/**
 * Boolean session settings written as a comma-separated name list with one trailing ON/OFF.
 *
 * FIPS_FLAGGER is accepted in that form only for OFF; its named levels use the value form.
 */
const onOffSetOptionNames = new Set([
    "ANSI_DEFAULTS",
    "ANSI_NULL_DFLT_OFF",
    "ANSI_NULL_DFLT_ON",
    "ANSI_NULLS",
    "ANSI_PADDING",
    "ANSI_WARNINGS",
    "ARITHABORT",
    "ARITHIGNORE",
    "CONCAT_NULL_YIELDS_NULL",
    "CURSOR_CLOSE_ON_COMMIT",
    "FIPS_FLAGGER",
    "FMTONLY",
    "FORCEPLAN",
    "IMPLICIT_TRANSACTIONS",
    "NO_BROWSETABLE",
    "NOCOUNT",
    "NOEXEC",
    "NUMERIC_ROUNDABORT",
    "PARSEONLY",
    "QUOTED_IDENTIFIER",
    "REMOTE_PROC_TRANSACTIONS",
    "SHOWPLAN_ALL",
    "SHOWPLAN_TEXT",
    "SHOWPLAN_XML",
    "XACT_ABORT",
]);

// These recognizers validate one already-parsed SET value token. They never discover a statement,
// clause, or identifier boundary.
const integerValue = (value: string): boolean => /^[+-]?\d+$/u.test(value);
const nameValue = (value: string): boolean =>
    /^'[^']*'$/u.test(value) ||
    new RegExp(`^${tsqlIdentifierPattern.ordinary}$`, "u").test(value) ||
    /^\[.*\]$/su.test(value);
const valueWord = (value: string): string =>
    (/^'(.*)'$/su.exec(value)?.[1] ?? value).trim().toUpperCase();

/** Named-value SET options and the lexical value family each accepts. */
const genericSetOptionValues = new Map<string, (value: string) => boolean>([
    [
        "DEADLOCK_PRIORITY",
        (value) => integerValue(value) || ["LOW", "NORMAL", "HIGH"].includes(valueWord(value)),
    ],
    ["LOCK_TIMEOUT", integerValue],
    ["QUERY_GOVERNOR_COST_LIMIT", integerValue],
    ["DATEFIRST", integerValue],
    ["LANGUAGE", nameValue],
    ["DATEFORMAT", nameValue],
    ["CONTEXT_INFO", (value) => /^0[xX][0-9a-fA-F]*$/u.test(value)],
    [
        "FIPS_FLAGGER",
        (value) => ["ENTRY", "INTERMEDIATE", "FULL", "OFF"].includes(valueWord(value)),
    ],
]);

/** Validates SET option names and value families from structured SET nodes. */
export function validateSetOptions(context: DiagnosticFamilyContext): void {
    for (const statement of context.nodes("SetStatement")) {
        if (containsSyntaxError(statement)) continue;

        for (const list of directChildrenOfKind(statement, "SetOnOffOptionList")) {
            const togglesOff = /\bOFF\s*;?\s*$/iu.test(context.source(statement));
            for (const nameNode of directChildrenOfKind(list, "IdentifierName")) {
                const spelling = context.source(nameNode).trim();
                const name = normalizeIdentifier(spelling).toUpperCase();
                if (!onOffSetOptionNames.has(name)) {
                    context.add(
                        "UnrecognizedOption",
                        `'${spelling}' is not a recognized option.`,
                        nameNode,
                    );
                    continue;
                }
                if (name === "FIPS_FLAGGER" && !togglesOff) {
                    context.add(
                        "IncorrectOptionValue",
                        `'ON' in not a correct value for option '${spelling}'.`,
                        nameNode,
                    );
                }
            }
        }

        for (const option of directChildrenOfKind(statement, "SetGenericOption")) {
            const nameNode = directChildrenOfKind(option, "IdentifierName")[0];
            if (!nameNode) continue;
            const spelling = context.source(nameNode).trim();
            const name = normalizeIdentifier(spelling).toUpperCase();
            const accepts = genericSetOptionValues.get(name);
            if (!accepts) {
                context.add(
                    "UnrecognizedOption",
                    `'${spelling}' is not a recognized option.`,
                    nameNode,
                );
                continue;
            }
            const valueNode = directChildrenOfKind(option, "SetGenericOptionValue")[0];
            if (!valueNode) continue;
            const valueText = context.source(valueNode).trim();
            if (valueText.startsWith("@")) continue;
            if (!accepts(valueText)) {
                context.add(
                    "IncorrectOptionValue",
                    `'${valueText}' in not a correct value for option '${spelling}'.`,
                    valueNode,
                );
            }
        }
    }
}
