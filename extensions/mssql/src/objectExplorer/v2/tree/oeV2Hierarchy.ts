/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Declarative OE v2 hierarchy registry (OE_V1_PARITY_PLAN §2.1) — the
 * in-code analog of STS's SmoTreeNodesDefinition.xml. Every folder the tree
 * renders is one entry here: label, scope, ordering, nesting, the catalog
 * section that backs it, and the gates that decide whether it appears at
 * all (server-vs-database-scoped connection, system-database context,
 * server version/edition, non-empty presence). Layout changes — including
 * the future SSMS-walkthrough spec — land as edits to this table, never as
 * new tree plumbing.
 *
 * Pure module: no vscode, no services; gating facts arrive as plain data.
 */

import type { ObjectKind } from "../../../services/metadata/catalogModel";

/** Connection/database context facts that gate folder visibility. */
export interface OeV2ScopeFacts {
    /** Profile pins an explicit database → server-level folders hidden. */
    readonly databaseScopedConnection?: boolean;
    /** Current database is master/model/msdb/tempdb → system folders show. */
    readonly isSystemDatabase?: boolean;
    readonly groupBySchema?: boolean;
    readonly serverMajorVersion?: number;
    readonly engineEdition?: number;
    readonly isAzure?: boolean;
}

export interface OeV2FolderDef {
    /** Stable slug; doubles as the path `folder` segment ("tables", "security/logins"). */
    readonly id: string;
    readonly label: string;
    readonly scope: "server" | "database";
    /** Nesting: id of the parent folder def; undefined = direct child of the scope root. */
    readonly parentId?: string;
    /** SSMS ordering among siblings (sortLast overrides). */
    readonly order: number;
    /** Catalog section whose readiness gates this folder's honesty. */
    readonly section: string;
    /** Object kinds listed from the database snapshot (object folders only). */
    readonly objectKinds?: readonly ObjectKind[];
    /** Non-object content routed by id ("databases" states table, "schemas" list). */
    readonly special?: "databases" | "schemas";
    /** Stripped unless the connected database is a system database (K2). */
    readonly isSystemFolder?: boolean;
    /** "nonEmpty" folders are hidden when they would render zero items (K3). */
    readonly presence?: "always" | "nonEmpty";
    /** Dropped Ledger* pattern: sorts after every normally-ordered sibling. */
    readonly sortLast?: boolean;
    readonly canFilter?: boolean;
    readonly icon?: string;
    /** Version/edition/connection-shape gate; absent = always valid. */
    readonly validFor?: (facts: OeV2ScopeFacts) => boolean;
}

/**
 * The layout table. B22 carries exactly the pre-registry content (Databases
 * at server scope; six database folders) so rendering stays byte-identical;
 * B23/B24 extend it toward the SSMS layout.
 */
export const OE_V2_HIERARCHY: readonly OeV2FolderDef[] = [
    // -- server scope --------------------------------------------------------
    {
        id: "databases",
        label: "Databases",
        scope: "server",
        order: 0,
        section: "databases",
        special: "databases",
        icon: "Folder",
    },
    // -- database scope ------------------------------------------------------
    {
        id: "tables",
        label: "Tables",
        scope: "database",
        order: 0,
        section: "objects",
        objectKinds: ["table"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "views",
        label: "Views",
        scope: "database",
        order: 1,
        section: "objects",
        objectKinds: ["view"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "storedProcedures",
        label: "Stored Procedures",
        scope: "database",
        order: 2,
        section: "objects",
        objectKinds: ["procedure"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "functions",
        label: "Functions",
        scope: "database",
        order: 3,
        section: "objects",
        objectKinds: ["scalarFunction", "tableFunction"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "synonyms",
        label: "Synonyms",
        scope: "database",
        order: 4,
        section: "synonyms",
        objectKinds: ["synonym"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "schemas",
        label: "Schemas",
        scope: "database",
        order: 5,
        section: "schemas",
        special: "schemas",
        icon: "Folder",
    },
];

const BY_ID = new Map(OE_V2_HIERARCHY.map((def) => [defKey(def), def]));

function defKey(def: OeV2FolderDef): string {
    return `${def.scope}:${def.id}`;
}

export function folderDef(scope: OeV2FolderDef["scope"], id: string): OeV2FolderDef | undefined {
    return BY_ID.get(`${scope}:${id}`);
}

export interface ResolveFolderOptions {
    /** Resolve children of this folder def id; undefined = scope root. */
    readonly parentId?: string;
    /** Item availability for presence:"nonEmpty" defs; absent = treat as non-empty. */
    readonly hasItems?: (def: OeV2FolderDef) => boolean;
}

/**
 * The one visibility decision point: scope + parent match, validFor gate,
 * system-folder stripping outside system-database context, non-empty
 * presence — returned in SSMS order (sortLast pushed to the tail).
 */
export function resolveFolders(
    scope: OeV2FolderDef["scope"],
    facts: OeV2ScopeFacts,
    options: ResolveFolderOptions = {},
    registry: readonly OeV2FolderDef[] = OE_V2_HIERARCHY,
): OeV2FolderDef[] {
    return registry
        .filter((def) => {
            if (def.scope !== scope || def.parentId !== options.parentId) {
                return false;
            }
            if (def.validFor && !def.validFor(facts)) {
                return false;
            }
            if (def.isSystemFolder && facts.isSystemDatabase !== true) {
                return false;
            }
            if (def.presence === "nonEmpty" && options.hasItems && !options.hasItems(def)) {
                return false;
            }
            return true;
        })
        .sort((a, z) => (a.sortLast === z.sortLast ? a.order - z.order : a.sortLast ? 1 : -1));
}

/** master/model/msdb/tempdb (the STS IsSystemDatabaseConnection analog). */
export function isSystemDatabaseName(database: string | undefined): boolean {
    if (!database) {
        return false;
    }
    const normalized = database.toLowerCase();
    return (
        normalized === "master" ||
        normalized === "model" ||
        normalized === "msdb" ||
        normalized === "tempdb"
    );
}
