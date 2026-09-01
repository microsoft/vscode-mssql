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

export type HandoffLevel = "h0" | "h1" | "h2";

export interface LegacyCommandPolicy {
    /** Stable feature key (diagnostics carry this, not labels). */
    readonly feature: string;
    /** Quick-pick label. */
    readonly label: string;
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
        // v1 parity: Compare Schemas… appears on servers AND databases.
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "editTable",
        label: "Edit Table (legacy Table Designer)",
        classicCommand: "mssql.editTable",
        level: "h2",
        nodeKinds: ["object"],
    },
    // v1 menu parity batch: the remaining classic commands from the three
    // core menus (connection/database/table). Handler-verified levels:
    // h0 features read only profile/metadata (or self-connect); h2 features
    // read node.sessionId or need a live classic connection resolvable from
    // the profile (the handoff connection provides both).
    {
        feature: "tableExplorer",
        label: "Edit Table Data… (legacy)",
        classicCommand: "mssql.tableExplorer",
        level: "h0",
        nodeKinds: ["object"],
    },
    {
        feature: "schemaDesigner",
        label: "Visualize and Design Schema… (legacy)",
        classicCommand: "mssql.schemaDesigner",
        level: "h2",
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "buildDataApi",
        label: "Build Data API… (legacy)",
        classicCommand: "mssql.buildDataApi",
        level: "h2",
        nodeKinds: ["database", "connectedServer"],
        databaseScoped: true,
    },
    {
        feature: "renameDatabase",
        label: "Rename Database… (legacy)",
        classicCommand: "mssql.renameDatabase",
        level: "h2",
        nodeKinds: ["database"],
    },
    {
        feature: "dropDatabase",
        label: "Drop Database… (legacy)",
        classicCommand: "mssql.dropDatabase",
        level: "h2",
        nodeKinds: ["database"],
    },
    {
        feature: "flatFileImport",
        label: "Import Data… (legacy)",
        classicCommand: "mssql.flatFileImport",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "dacpacDialog",
        label: "DACPAC/BACPAC Operations… (legacy)",
        classicCommand: "mssql.dacpacDialog.launch",
        level: "h2",
        nodeKinds: ["connectedServer", "database"],
    },
    {
        feature: "copyConnectionString",
        label: "Copy Connection String (legacy)",
        classicCommand: "mssql.copyConnectionString",
        level: "h0",
        nodeKinds: ["connectedServer", "disconnectedConnection"],
    },
    {
        feature: "chatWithDatabase",
        label: "Open in GitHub Copilot Chat (legacy)",
        classicCommand: "mssql.objectExplorerChatWithDatabase",
        level: "h0",
        nodeKinds: ["connectedServer", "database", "object"],
    },
    {
        feature: "chatWithDatabaseAgent",
        label: "Open in GitHub Copilot Agent (legacy)",
        classicCommand: "mssql.objectExplorerChatWithDatabaseInAgentMode",
        level: "h0",
        nodeKinds: ["connectedServer", "database", "object"],
    },
    {
        feature: "createNotebook",
        label: "New SQL Notebook (legacy)",
        classicCommand: "mssql.notebooks.createNotebook",
        level: "h0",
        nodeKinds: ["connectedServer", "database"],
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
