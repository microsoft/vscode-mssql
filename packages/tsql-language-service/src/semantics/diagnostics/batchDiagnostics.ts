/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxKind } from "../../syntax/index.js";
import { directChildrenOfKind } from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const onlyStatementModuleKinds = new Set<SyntaxKind>([
    "CreateFunctionStatement",
    "CreateProcedureStatement",
    "CreateTriggerStatement",
    "CreateViewStatement",
    "AlterFunctionStatement",
    "AlterProcedureStatement",
    "AlterTriggerStatement",
    "AlterViewStatement",
]);

/** Validates module DDL that must be the sole statement in its GO batch. */
export function validateBatchContracts(context: DiagnosticFamilyContext): void {
    for (const batch of context.nodes("Batch")) {
        const statements = directChildrenOfKind(batch, "Statement");
        if (statements.length === 1) continue;
        for (const statement of statements) {
            const body = [...statement.children()].find((child) =>
                onlyStatementModuleKinds.has(child.kind),
            );
            if (!body) continue;
            const phrase = moduleStatementPhrase(context.source(body));
            context.add(
                "MustBeOnlyStatementInBatch",
                `Incorrect syntax: '${phrase}' must be the only statement in the batch.`,
                body,
            );
        }
    }
}

function moduleStatementPhrase(source: string): string {
    const words = source
        .trimStart()
        .split(/\s+/u, 4)
        .map((word) => word.toUpperCase());
    if (words[0] === "CREATE" && words[1] === "OR" && words[2] === "ALTER") {
        return `${words[0]} ${words[1]} ${words[2]} ${words[3] ?? ""}`.trim();
    }
    return `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
}
