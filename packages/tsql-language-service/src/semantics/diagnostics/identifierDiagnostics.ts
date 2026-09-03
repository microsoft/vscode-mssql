/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/** Reports empty delimited identifiers from the parser's identifier nodes. */
export function validateIdentifierNames(context: DiagnosticFamilyContext): void {
    for (const identifier of context.nodes("IdentifierName")) {
        if (identifier.start === identifier.end) continue;
        if (normalizeIdentifier(context.source(identifier)).length > 0) continue;
        context.add(
            "ObjectNameIsMissingOrEmpty",
            'An object or column name is missing or empty. For SELECT INTO statements, verify each column has a name. For other statements, look for empty alias names. Aliases defined as "" or [] are not allowed. Change the alias to a valid name.',
            identifier,
        );
    }
}
