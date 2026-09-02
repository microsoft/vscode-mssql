/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from "../../syntax/index.js";
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
const conflictingGroups = [
    ["GLOBAL", "LOCAL"],
    ["FORWARD_ONLY", "SCROLL"],
    ["STATIC", "KEYSET", "DYNAMIC", "FAST_FORWARD"],
    ["READ_ONLY", "SCROLL_LOCKS", "OPTIMISTIC"],
] as const;

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
            let first: { readonly name: string; readonly node: SyntaxNode } | undefined;
            for (const option of options) {
                const name = context.source(option).trim().toUpperCase();
                if (!group.some((candidate) => candidate === name)) continue;
                if (!first) {
                    first = { name, node: option };
                    continue;
                }
                context.add(
                    "ConflictingCursorOption",
                    `Conflicting cursor options ${first.name} and ${name}.`,
                    option,
                );
            }
        }
    }
}
