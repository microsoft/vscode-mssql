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
import { OeV2ObjectKind } from "../tree/oeV2Path";

export type HandoffLevel = "h0" | "h1" | "h2";

export interface LegacyCommandPolicy {
    /** Stable feature key (diagnostics carry this, not labels). */
    readonly feature: string;
    /** Classic command id invoked after handoff. */
    readonly classicCommand: string;
    /**
     * h0 = adapted TreeNodeInfo argument, NO v1 connection (the classic
     * handler works from the profile/metadata alone, or opens its own);
     * h1 = connected owner URI only; h2 = adapted TreeNodeInfo argument
     * carrying a connected handoff owner URI.
     */
    readonly level: HandoffLevel;
    /** Node kinds this feature applies to. */
    readonly nodeKinds: readonly OeV2NodeKind[];
    /** Optional object-kind restriction for policies that accept object nodes. */
    readonly objectKinds?: readonly OeV2ObjectKind[];
    /** Requires a database-scoped node (adapter sets Database identity). */
    readonly databaseScoped?: boolean;
    /** Positional arguments required by a classic handler after its node. */
    readonly additionalCommandArguments?: readonly unknown[];
}

export const LEGACY_COMMAND_POLICIES: readonly LegacyCommandPolicy[] = [
    {
        feature: "backupDatabase",
        classicCommand: "mssql.backupDatabase",
        level: "h2",
        // connectedServer ONLY when the connection is DB-scoped (the node
        // carries a database) — policiesForNode filters on that fact.
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "restoreDatabase",
        classicCommand: "mssql.restoreDatabase",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "profiler",
        classicCommand: "mssql.profiler.launchFromObjectExplorer",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "schemaCompare",
        classicCommand: "mssql.schemaCompare",
        level: "h2",
        // v1 parity: Compare Schemas… appears on servers AND databases.
        nodeKinds: ["connectedServer", "database"],
        // The classic handler only inspects source/target when it receives at
        // least two positional arguments. Preserve the selected v2 node as
        // the source and leave the target unset.
        additionalCommandArguments: [undefined],
    },
    {
        feature: "editTable",
        classicCommand: "mssql.editTable",
        level: "h2",
        nodeKinds: ["object"],
        objectKinds: ["table"],
    },
    // v1 menu parity batch: the remaining classic commands from the three
    // core menus (connection/database/table). Handler-verified levels:
    // h0 features read only profile/metadata (or self-connect); h2 features
    // read node.sessionId or need a live classic connection resolvable from
    // the profile (the handoff connection provides both).
    {
        feature: "tableExplorer",
        classicCommand: "mssql.tableExplorer",
        level: "h0",
        nodeKinds: ["object"],
        objectKinds: ["table"],
    },
    {
        feature: "schemaDesigner",
        classicCommand: "mssql.schemaDesigner",
        level: "h2",
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "buildDataApi",
        classicCommand: "mssql.buildDataApi",
        level: "h2",
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "renameDatabase",
        classicCommand: "mssql.renameDatabase",
        level: "h2",
        nodeKinds: ["database"],
    },
    {
        feature: "dropDatabase",
        classicCommand: "mssql.dropDatabase",
        level: "h2",
        nodeKinds: ["database"],
    },
    {
        feature: "flatFileImport",
        classicCommand: "mssql.flatFileImport",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "dacpacDialog",
        classicCommand: "mssql.dacpacDialog.launch",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "copyConnectionString",
        classicCommand: "mssql.copyConnectionString",
        level: "h0",
        nodeKinds: ["connectedServer", "disconnectedConnection", "lostConnection"],
    },
    {
        feature: "chatWithDatabase",
        classicCommand: "mssql.objectExplorerChatWithDatabase",
        level: "h0",
        nodeKinds: ["connectedServer", "database", "object"],
        objectKinds: ["table"],
    },
    {
        feature: "chatWithDatabaseAgent",
        classicCommand: "mssql.objectExplorerChatWithDatabaseInAgentMode",
        level: "h0",
        nodeKinds: ["connectedServer", "database", "object"],
        objectKinds: ["table"],
    },
    {
        feature: "createNotebook",
        classicCommand: "mssql.notebooks.createNotebook",
        level: "h0",
        nodeKinds: ["connectedServer", "database"],
    },
];

export function policiesForNode(
    kind: OeV2NodeKind,
    nodeDatabase?: string,
    objectKind?: OeV2ObjectKind,
): LegacyCommandPolicy[] {
    return LEGACY_COMMAND_POLICIES.filter((policy) => {
        if (!policy.nodeKinds.includes(kind)) {
            return false;
        }
        // Database-scoped features on a top-level connection need the
        // connection itself to be DB-scoped (K4 backup rule).
        if (policy.databaseScoped && kind === "connectedServer" && nodeDatabase === undefined) {
            return false;
        }
        if (
            kind === "object" &&
            policy.objectKinds !== undefined &&
            (objectKind === undefined || !policy.objectKinds.includes(objectKind))
        ) {
            return false;
        }
        return true;
    });
}
