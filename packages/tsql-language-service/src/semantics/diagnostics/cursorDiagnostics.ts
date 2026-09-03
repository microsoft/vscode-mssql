/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { containsSyntaxError, directChildrenOfKind } from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const cursorOptionNames = new Set([
    "FAST_FORWARD",
    "FORWARD_ONLY",
    "DYNAMIC",
    "GLOBAL",
    "INSENSITIVE",
    "KEYSET",
    "LOCAL",
    "OPTIMISTIC",
    "READ_ONLY",
    "SCROLL",
    "SCROLL_LOCKS",
    "STATIC",
    "TYPE_WARNING",
]);
const isoCursorOptionNames = new Set(["INSENSITIVE", "SCROLL"]);
const conflictingGroups: readonly (readonly string[])[] = [
    ["GLOBAL", "LOCAL"],
    ["FORWARD_ONLY", "SCROLL"],
    ["STATIC", "KEYSET", "DYNAMIC", "FAST_FORWARD"],
    ["READ_ONLY", "SCROLL_LOCKS", "OPTIMISTIC"],
];

/** Validates ISO and extended DECLARE CURSOR option families from structured option nodes. */
export function validateCursorOptions(context: DiagnosticFamilyContext): void {
    for (const cursor of context.nodes("CursorDeclaration")) {
        if (containsSyntaxError(cursor)) continue;
        const isoOptions = directChildrenOfKind(cursor, "CursorIsoOption");
        const options = directChildrenOfKind(cursor, "CursorOption");
        if (isoOptions.length > 0 && options.length > 0) {
            context.add(
                "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
                "Mixing old and new syntax to specify cursor options is not allowed.",
                cursor,
            );
        }
        for (const option of [...isoOptions, ...options]) {
            const spelling = context.source(option).trim();
            const name = spelling.toUpperCase();
            if (!cursorOptionNames.has(name)) {
                context.add(
                    "UnrecognizedCursorOption",
                    `'${spelling}' is not a recognized CURSOR option.`,
                    option,
                );
                continue;
            }
            const allowed = isoOptions.includes(option)
                ? isoCursorOptionNames.has(name)
                : name !== "INSENSITIVE";
            if (!allowed) {
                context.add(
                    "InvalidUsageOfCursorOption",
                    `Invalid usage of the option '${spelling}' in the DECLARE CURSOR statement.`,
                    option,
                );
            }
        }
        for (const group of conflictingGroups) {
            let first: { readonly spelling: string; readonly rank: number } | undefined;
            for (const option of options) {
                const spelling = context.source(option).trim();
                const rank = group.indexOf(spelling.toUpperCase());
                if (rank < 0) continue;
                if (!first) {
                    first = { spelling, rank };
                    continue;
                }
                // The pair is named in the option family's own order, not in writing order.
                const [left, right] =
                    first.rank <= rank ? [first.spelling, spelling] : [spelling, first.spelling];
                context.add(
                    "ConflictingCursorOption",
                    `Conflicting cursor options ${left} and ${right}.`,
                    option,
                );
            }
        }
    }
}
