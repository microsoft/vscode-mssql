/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    containsSyntaxError,
    descendantsOwnedByKind,
    directChildrenOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import { normalizeIdentifier } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

// ColumnConstraint and TableConstraintBody are already parser-owned nodes. These anchored patterns
// classify only the constraint kind retained inside those nodes and are covered by focused positive,
// negative, malformed, and incremental constraint tests.
const storedComputedColumnConstraint =
    /^\s*(?:CONSTRAINT\s+\S+\s+)?(?:CHECK|FOREIGN\s+KEY|REFERENCES|NOT\s+NULL)\b/iu;
const keyConstraint = /^\s*(?:PRIMARY\s+KEY|UNIQUE)\b/iu;

/** Validates non-persisted computed-column constraint restrictions. */
export function validateComputedColumnConstraints(context: DiagnosticFamilyContext): void {
    for (const column of context.nodes("ColumnDefinition")) {
        if (containsSyntaxError(column)) continue;
        if (directChildrenOfKind(column, "DataType").length > 0) continue;
        if (directChildrenOfKind(column, "Persisted").length > 0) continue;
        for (const constraint of directChildrenOfKind(column, "ColumnConstraint")) {
            if (!storedComputedColumnConstraint.test(context.source(constraint))) continue;
            context.add(
                "ComputedColumnsConstraintCheckError",
                "Only UNIQUE or PRIMARY KEY constraints can be created on computed columns, while CHECK, FOREIGN KEY, and NOT NULL constraints require that computed columns be persisted.",
                constraint,
            );
        }
    }
}

/** Validates options accepted by PRIMARY KEY and UNIQUE constraint-backed indexes. */
export function validateConstraintIndexOptions(context: DiagnosticFamilyContext): void {
    for (const clause of context.nodes("ConstraintIndexWithClause")) {
        if (containsSyntaxError(clause)) continue;
        const constraint =
            parentOfKind(clause, "TableConstraintBody") ?? parentOfKind(clause, "ColumnConstraint");
        if (!constraint || !keyConstraint.test(context.source(constraint))) continue;
        const inCreate = parentOfKind(clause, "CreateTableStatement") !== undefined;
        for (const option of descendantsOwnedByKind(clause, "GenericOptionName", clause)) {
            const name = normalizeIdentifier(context.source(option).trim()).toUpperCase();
            const rejected =
                forbiddenIndexOptions.has(name) || (inCreate && buildOnlyIndexOptions.has(name));
            if (rejected) {
                context.add("UnrecognizedOption", `'${name}' is not a recognized option.`, option);
            }
        }
    }
}

const forbiddenIndexOptions = new Set(["DROP_EXISTING", "STATISTICS_ONLY"]);
const buildOnlyIndexOptions = new Set(["MAXDOP", "ONLINE", "SORT_IN_TEMPDB"]);
