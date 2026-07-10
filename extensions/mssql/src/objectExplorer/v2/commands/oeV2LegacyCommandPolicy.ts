/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The legacy handoff policy table IN CODE (oe_view_design §12.4): which
 * classic features OE v2 exposes, at which handoff level, on which node
 * kinds. A feature appears here because a route exists and is guarded —
 * never because a classic context regex would have matched. H3 (real
 * classic OE session) is deliberately absent until a command proves it
 * needs one.
 */

import { OeV2NodeKind } from "../tree/oeV2Node";

export type HandoffLevel = "h1" | "h2";

export interface LegacyCommandPolicy {
    /** Stable feature key (diagnostics carry this, not labels). */
    readonly feature: string;
    /** Quick-pick label. */
    readonly label: string;
    /** Classic command id invoked after handoff. */
    readonly classicCommand: string;
    /** h1 = connected owner URI only; h2 = adapted TreeNodeInfo argument. */
    readonly level: HandoffLevel;
    /** Node kinds this feature applies to. */
    readonly nodeKinds: readonly OeV2NodeKind[];
    /** Requires a database-scoped node (adapter sets Database identity). */
    readonly databaseScoped?: boolean;
}

export const LEGACY_COMMAND_POLICIES: readonly LegacyCommandPolicy[] = [
    {
        feature: "backupDatabase",
        label: "Backup Database… (legacy)",
        classicCommand: "mssql.backupDatabase",
        level: "h2",
        // connectedServer ONLY when the connection is DB-scoped (the node
        // carries a database) — policiesForNode filters on that fact.
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "restoreDatabase",
        label: "Restore Database… (legacy)",
        classicCommand: "mssql.restoreDatabase",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "profiler",
        label: "Launch Profiler (legacy)",
        classicCommand: "mssql.profiler.launchFromObjectExplorer",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "schemaCompare",
        label: "Schema Compare (legacy)",
        classicCommand: "mssql.schemaCompare",
        level: "h2",
        nodeKinds: ["database"],
        databaseScoped: true,
    },
    {
        feature: "editTable",
        label: "Edit Table (legacy Table Designer)",
        classicCommand: "mssql.editTable",
        level: "h2",
        nodeKinds: ["object"],
    },
];

export function policiesForNode(kind: OeV2NodeKind, nodeDatabase?: string): LegacyCommandPolicy[] {
    return LEGACY_COMMAND_POLICIES.filter((policy) => {
        if (!policy.nodeKinds.includes(kind)) {
            return false;
        }
        // Database-scoped features on a top-level connection need the
        // connection itself to be DB-scoped (K4 backup rule).
        if (policy.databaseScoped && kind === "connectedServer" && nodeDatabase === undefined) {
            return false;
        }
        return true;
    });
}
