/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { engineCapabilitySet, engineProfileDisplayName } from "../common/index.js";
import type { MetadataView } from "../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../syntax/index.js";
import { directChildOfKind, visitSyntaxTree } from "../syntax/treeUtilities.js";
import type { SemanticDiagnostic } from "./contracts.js";
import { rowsetNameNode, rowsetNameOwnerKinds } from "./model/nameNodes.js";

/**
 * Platform restrictions that need a metadata fact as well as a structured node.
 *
 * The syntax layer reports what a grammar node alone can decide. A name that reaches another
 * database is not one of those: whether it crosses a boundary depends on which database the
 * connection is in, so the decision belongs here, where the pinned metadata view is available.
 *
 * Every check requires both an authoritative capability and an authoritative metadata fact. A
 * deferred capability, an unidentified engine, or an unreported current database produces nothing.
 */
export function platformSemanticDiagnostics(
    syntax: SyntaxSnapshot,
    root: SyntaxNode,
    metadata: MetadataView,
): readonly SemanticDiagnostic[] {
    const capabilities = engineCapabilitySet(syntax.profile);
    if (capabilities.crossDatabaseReferences !== "unavailable") return [];
    const currentDatabase = metadata.environment.currentDatabase;
    if (!currentDatabase) return [];

    const diagnostics: SemanticDiagnostic[] = [];
    const profileName = engineProfileDisplayName(syntax.profile.engineProfile);
    visitSyntaxTree(root, (node) => {
        if (!rowsetNameOwnerKinds.includes(node.kind)) return;
        // A `FROM` source is reached through its own wrapper as well as its enclosing owner; only
        // the wrapper reports it, so one written name never produces two diagnostics.
        if (node.kind !== "TableSourceName" && directChildOfKind(node, "TableSourceName")) return;
        const identifier = rowsetNameNode(node);
        if (!identifier) return;
        const parts = [...identifier.children()].filter((child) => child.kind === "IdentifierName");
        // A three-part name is `database.schema.object`; a four-part name adds a linked server,
        // which this engine has no surface for either.
        if (parts.length < 3) return;
        const database = parts[parts.length - 3]!;
        const written = undelimit(syntax.document.text.slice(database.start, database.end));
        if (written.length === 0) return;
        if (equalsIdentifier(written, currentDatabase, metadata.environment.caseSensitive)) return;
        diagnostics.push({
            code: "CrossDatabaseReferenceNotAvailable",
            message: `A name in another database is not available on ${profileName}. Reference objects in the connected database instead.`,
            severity: "error",
            range: { start: database.start, end: database.end },
        });
    });
    return Object.freeze(diagnostics);
}

function equalsIdentifier(left: string, right: string, caseSensitive: boolean): boolean {
    return caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
}

function undelimit(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1);
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
    return trimmed;
}
