/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier } from "../identifiers.js";
import type { SyntaxNode } from "../../syntax/index.js";
import { containsSyntaxError, firstDescendantOfKind } from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const allowedParameters = new Set([
    "DATA_SOURCE",
    "FILE_FORMAT",
    "INPUT_OPTIONS",
    "LOCATION",
    "OUTPUT_OPTIONS",
]);
const requiredParameters = ["DATA_SOURCE"] as const;

/** Validates the closed named-option contract of CREATE EXTERNAL STREAM. */
export function validateExternalStreamParameters(context: DiagnosticFamilyContext): void {
    for (const statement of context.nodes("CreateExternalStreamStatement")) {
        const parameters: SyntaxNode[] = [];
        for (const child of statement.children()) {
            if (child.kind === "⚠") break;
            if (child.kind === "ExternalStreamParam") parameters.push(child);
        }
        if (parameters.length === 0) continue;
        const seen = new Set<string>();
        for (const parameter of parameters) {
            const nameNode = firstDescendantOfKind(parameter, "IdentifierName");
            if (!nameNode) continue;
            const name = normalizeIdentifier(context.source(nameNode)).toUpperCase();
            if (!allowedParameters.has(name)) continue;
            if (seen.has(name)) {
                context.add(
                    "DuplicateParam",
                    `The external stream option '${name}' is already included in ddl.`,
                    parameter,
                );
            }
            seen.add(name);
        }
        for (const required of requiredParameters) {
            if (seen.has(required)) continue;
            const range = containsSyntaxError(statement)
                ? { start: statement.start, end: parameters.at(-1)!.end }
                : statement;
            context.add(
                "RequiredParam",
                `The external stream option '${required}' must be included in the ddl.`,
                range,
            );
        }
    }
}
