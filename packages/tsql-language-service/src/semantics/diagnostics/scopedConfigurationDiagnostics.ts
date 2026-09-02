/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier } from "../identifiers.js";
import { containsSyntaxError, firstDescendantOfKind } from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const booleanConfigurationNames = new Set([
    "LEGACY_CARDINALITY_ESTIMATION",
    "PARAMETER_SNIFFING",
    "QUERY_OPTIMIZER_HOTFIXES",
]);

// A ConfigurationValue is already a parser-owned value node. This recognizer only distinguishes
// its signed-integer lexical spelling; it never discovers a statement or clause boundary.
const signedIntegerValue = /^[+-]?\d+$/u;

/** Validates the fixed value families of database-scoped configuration settings. */
export function validateScopedConfigurations(context: DiagnosticFamilyContext): void {
    for (const setting of context.nodes("DatabaseScopedConfigurationSetting")) {
        if (containsSyntaxError(setting)) continue;
        const nameNode = firstDescendantOfKind(setting, "IdentifierName");
        const valueNode = firstDescendantOfKind(setting, "ConfigurationValue");
        if (!nameNode || !valueNode) continue;

        const displayName = normalizeIdentifier(context.source(nameNode));
        const name = displayName.toUpperCase();
        const value = context.source(valueNode).trim().toUpperCase();
        const valid =
            name === "MAXDOP"
                ? value === "PRIMARY" || signedIntegerValue.test(value)
                : booleanConfigurationNames.has(name)
                  ? value === "PRIMARY" || value === "ON" || value === "OFF"
                  : true;
        if (valid) continue;

        context.add(
            "InvalidUsageOfScopedConfiguration",
            `Invalid usage of the scoped configuration ${displayName} in the ALTER DATABASE statement.`,
            valueNode,
        );
    }
}
