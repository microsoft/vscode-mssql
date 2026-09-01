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
    /** Facet fact (tableFacets/viewFacets) that selects this folder's items. */
    readonly facetFlag?: string;
    /** Aux leaves whose SYSTEM items hide outside system-database context (K2). */
    readonly hideSystemItems?: boolean;
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
    // Server-level folders appear for SERVER-scoped connections only (K1);
    // Server Objects is on-prem only (STS ValidFor AllOnPrem).
    {
        id: "security",
        label: "Security",
        scope: "server",
        order: 1,
        section: "aux",
        icon: "Folder",
        validFor: (facts) => facts.databaseScopedConnection !== true,
    },
    {
        id: "security/logins",
        label: "Logins",
        scope: "server",
        parentId: "security",
        order: 0,
        section: "security/logins",
        icon: "Folder",
    },
    {
        id: "security/serverRoles",
        label: "Server Roles",
        scope: "server",
        parentId: "security",
        order: 1,
        section: "security/serverRoles",
        icon: "Folder",
    },
    {
        id: "security/credentials",
        label: "Credentials",
        scope: "server",
        parentId: "security",
        order: 2,
        section: "security/credentials",
        icon: "Folder",
        validFor: (facts) => facts.isAzure !== true,
    },
    {
        id: "security/cryptographicProviders",
        label: "Cryptographic Providers",
        scope: "server",
        parentId: "security",
        order: 3,
        section: "security/cryptographicProviders",
        icon: "Folder",
        validFor: (facts) => facts.isAzure !== true,
    },
    {
        id: "security/serverAudits",
        label: "Server Audits",
        scope: "server",
        parentId: "security",
        order: 4,
        section: "security/serverAudits",
        icon: "Folder",
        validFor: (facts) => facts.isAzure !== true,
    },
    {
        id: "security/serverAuditSpecifications",
        label: "Server Audit Specifications",
        scope: "server",
        parentId: "security",
        order: 5,
        section: "security/serverAuditSpecifications",
        icon: "Folder",
        validFor: (facts) => facts.isAzure !== true,
    },
    {
        id: "serverObjects",
        label: "Server Objects",
        scope: "server",
        order: 2,
        section: "aux",
        icon: "Folder",
        validFor: (facts) => facts.databaseScopedConnection !== true && facts.isAzure !== true,
    },
    {
        id: "serverObjects/endpoints",
        label: "Endpoints",
        scope: "server",
        parentId: "serverObjects",
        order: 0,
        section: "serverObjects/endpoints",
        icon: "Folder",
    },
    {
        id: "serverObjects/linkedServers",
        label: "Linked Servers",
        scope: "server",
        parentId: "serverObjects",
        order: 1,
        section: "serverObjects/linkedServers",
        icon: "Folder",
    },
    {
        id: "serverObjects/serverTriggers",
        label: "Server Triggers",
        scope: "server",
        parentId: "serverObjects",
        order: 2,
        section: "serverObjects/serverTriggers",
        icon: "Folder",
    },
    {
        id: "serverObjects/errorMessages",
        label: "Error Messages",
        scope: "server",
        parentId: "serverObjects",
        order: 3,
        section: "serverObjects/errorMessages",
        icon: "Folder",
    },
    // -- database scope (SSMS layout, B24) -------------------------------------
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
        id: "tables/systemTables",
        label: "System Tables",
        scope: "database",
        parentId: "tables",
        order: 0,
        section: "systemObjects",
        objectKinds: ["table"],
        isSystemFolder: true,
        icon: "Folder",
    },
    {
        id: "tables/droppedLedgerTables",
        label: "Dropped Ledger Tables",
        scope: "database",
        parentId: "tables",
        order: 1,
        section: "tableFacets",
        presence: "nonEmpty",
        facetFlag: "isDroppedLedger",
        sortLast: true,
        icon: "Folder",
    },
    // External Tables (dogfood #7, v1 parity): appears ONLY when external
    // tables exist, after the table items. Items are REAL catalog objects
    // (columns expand, scripting) selected from the snapshot by facet.
    {
        id: "tables/externalTables",
        label: "External Tables",
        scope: "database",
        parentId: "tables",
        order: 2,
        section: "tableFacets",
        objectKinds: ["table"],
        presence: "nonEmpty",
        facetFlag: "isExternal",
        sortLast: true,
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
        id: "views/systemViews",
        label: "System Views",
        scope: "database",
        parentId: "views",
        order: 0,
        section: "systemObjects",
        objectKinds: ["view"],
        isSystemFolder: true,
        icon: "Folder",
    },
    {
        id: "views/droppedLedgerViews",
        label: "Dropped Ledger Views",
        scope: "database",
        parentId: "views",
        order: 1,
        section: "viewFacets",
        presence: "nonEmpty",
        facetFlag: "isDroppedLedger",
        sortLast: true,
        icon: "Folder",
    },
    {
        id: "synonyms",
        label: "Synonyms",
        scope: "database",
        order: 2,
        section: "synonyms",
        objectKinds: ["synonym"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "programmability",
        label: "Programmability",
        scope: "database",
        order: 3,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "storedProcedures",
        label: "Stored Procedures",
        scope: "database",
        parentId: "programmability",
        order: 0,
        section: "objects",
        objectKinds: ["procedure"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "storedProcedures/systemStoredProcedures",
        label: "System Stored Procedures",
        scope: "database",
        parentId: "storedProcedures",
        order: 0,
        section: "systemObjects",
        objectKinds: ["procedure"],
        isSystemFolder: true,
        icon: "Folder",
    },
    {
        id: "functions",
        label: "Functions",
        scope: "database",
        parentId: "programmability",
        order: 1,
        section: "objects",
        objectKinds: ["scalarFunction", "tableFunction"],
        canFilter: true,
        icon: "Folder",
    },
    {
        id: "programmability/databaseTriggers",
        label: "Database Triggers",
        scope: "database",
        parentId: "programmability",
        order: 2,
        section: "programmability/databaseTriggers",
        icon: "Folder",
    },
    {
        id: "programmability/assemblies",
        label: "Assemblies",
        scope: "database",
        parentId: "programmability",
        order: 3,
        section: "programmability/assemblies",
        icon: "Folder",
    },
    {
        id: "programmability/types",
        label: "Types",
        scope: "database",
        parentId: "programmability",
        order: 4,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "programmability/types/userDefinedDataTypes",
        label: "User-Defined Data Types",
        scope: "database",
        parentId: "programmability/types",
        order: 0,
        section: "programmability/types/userDefinedDataTypes",
        icon: "Folder",
    },
    {
        id: "programmability/types/userDefinedTableTypes",
        label: "User-Defined Table Types",
        scope: "database",
        parentId: "programmability/types",
        order: 1,
        section: "programmability/types/userDefinedTableTypes",
        icon: "Folder",
    },
    {
        id: "programmability/types/xmlSchemaCollections",
        label: "XML Schema Collections",
        scope: "database",
        parentId: "programmability/types",
        order: 2,
        section: "programmability/types/xmlSchemaCollections",
        icon: "Folder",
    },
    {
        id: "programmability/sequences",
        label: "Sequences",
        scope: "database",
        parentId: "programmability",
        order: 5,
        section: "programmability/sequences",
        icon: "Folder",
    },
    {
        id: "serviceBroker",
        label: "Service Broker",
        scope: "database",
        order: 4,
        section: "aux",
        icon: "Folder",
        validFor: (facts) => facts.isAzure !== true,
    },
    {
        id: "serviceBroker/messageTypes",
        label: "Message Types",
        scope: "database",
        parentId: "serviceBroker",
        order: 0,
        section: "serviceBroker/messageTypes",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "serviceBroker/contracts",
        label: "Contracts",
        scope: "database",
        parentId: "serviceBroker",
        order: 1,
        section: "serviceBroker/contracts",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "serviceBroker/queues",
        label: "Queues",
        scope: "database",
        parentId: "serviceBroker",
        order: 2,
        section: "serviceBroker/queues",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "serviceBroker/services",
        label: "Services",
        scope: "database",
        parentId: "serviceBroker",
        order: 3,
        section: "serviceBroker/services",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "serviceBroker/remoteServiceBindings",
        label: "Remote Service Bindings",
        scope: "database",
        parentId: "serviceBroker",
        order: 4,
        section: "serviceBroker/remoteServiceBindings",
        icon: "Folder",
    },
    {
        id: "serviceBroker/brokerPriorities",
        label: "Broker Priorities",
        scope: "database",
        parentId: "serviceBroker",
        order: 5,
        section: "serviceBroker/brokerPriorities",
        icon: "Folder",
    },
    {
        id: "storage",
        label: "Storage",
        scope: "database",
        order: 5,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "storage/fileGroups",
        label: "Filegroups",
        scope: "database",
        parentId: "storage",
        order: 0,
        section: "storage/fileGroups",
        icon: "Folder",
    },
    {
        id: "storage/fullTextCatalogs",
        label: "Full Text Catalogs",
        scope: "database",
        parentId: "storage",
        order: 1,
        section: "storage/fullTextCatalogs",
        icon: "Folder",
    },
    {
        id: "storage/fullTextStopLists",
        label: "Full Text Stop Lists",
        scope: "database",
        parentId: "storage",
        order: 2,
        section: "storage/fullTextStopLists",
        icon: "Folder",
    },
    {
        id: "storage/logFiles",
        label: "Log Files",
        scope: "database",
        parentId: "storage",
        order: 3,
        section: "storage/logFiles",
        icon: "Folder",
    },
    {
        id: "storage/partitionFunctions",
        label: "Partition Functions",
        scope: "database",
        parentId: "storage",
        order: 4,
        section: "storage/partitionFunctions",
        icon: "Folder",
    },
    {
        id: "storage/partitionSchemes",
        label: "Partition Schemes",
        scope: "database",
        parentId: "storage",
        order: 5,
        section: "storage/partitionSchemes",
        icon: "Folder",
    },
    {
        id: "storage/searchPropertyLists",
        label: "Search Property Lists",
        scope: "database",
        parentId: "storage",
        order: 6,
        section: "storage/searchPropertyLists",
        icon: "Folder",
    },
    {
        id: "dbSecurity",
        label: "Security",
        scope: "database",
        order: 6,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "security/users",
        label: "Users",
        scope: "database",
        parentId: "dbSecurity",
        order: 0,
        section: "security/users",
        icon: "Folder",
    },
    {
        id: "security/roles",
        label: "Roles",
        scope: "database",
        parentId: "dbSecurity",
        order: 1,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "security/roles/databaseRoles",
        label: "Database Roles",
        scope: "database",
        parentId: "security/roles",
        order: 0,
        section: "security/roles/databaseRoles",
        icon: "Folder",
    },
    {
        id: "security/roles/applicationRoles",
        label: "Application Roles",
        scope: "database",
        parentId: "security/roles",
        order: 1,
        section: "security/roles/applicationRoles",
        icon: "Folder",
    },
    {
        id: "schemas",
        label: "Schemas",
        scope: "database",
        parentId: "dbSecurity",
        order: 2,
        section: "schemas",
        special: "schemas",
        icon: "Folder",
    },
    {
        id: "security/asymmetricKeys",
        label: "Asymmetric Keys",
        scope: "database",
        parentId: "dbSecurity",
        order: 3,
        section: "security/asymmetricKeys",
        icon: "Folder",
    },
    {
        id: "security/certificates",
        label: "Certificates",
        scope: "database",
        parentId: "dbSecurity",
        order: 4,
        section: "security/certificates",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "security/symmetricKeys",
        label: "Symmetric Keys",
        scope: "database",
        parentId: "dbSecurity",
        order: 5,
        section: "security/symmetricKeys",
        hideSystemItems: true,
        icon: "Folder",
    },
    {
        id: "security/databaseScopedCredentials",
        label: "Database Scoped Credentials",
        scope: "database",
        parentId: "dbSecurity",
        order: 6,
        section: "security/databaseScopedCredentials",
        icon: "Folder",
    },
    {
        id: "security/databaseAuditSpecifications",
        label: "Database Audit Specifications",
        scope: "database",
        parentId: "dbSecurity",
        order: 7,
        section: "security/databaseAuditSpecifications",
        icon: "Folder",
    },
    {
        id: "security/securityPolicies",
        label: "Security Policies",
        scope: "database",
        parentId: "dbSecurity",
        order: 8,
        section: "security/securityPolicies",
        icon: "Folder",
    },
    {
        id: "security/alwaysEncryptedKeys",
        label: "Always Encrypted Keys",
        scope: "database",
        parentId: "dbSecurity",
        order: 9,
        section: "aux",
        icon: "Folder",
    },
    {
        id: "security/alwaysEncryptedKeys/columnMasterKeys",
        label: "Column Master Keys",
        scope: "database",
        parentId: "security/alwaysEncryptedKeys",
        order: 0,
        section: "security/alwaysEncryptedKeys/columnMasterKeys",
        icon: "Folder",
    },
    {
        id: "security/alwaysEncryptedKeys/columnEncryptionKeys",
        label: "Column Encryption Keys",
        scope: "database",
        parentId: "security/alwaysEncryptedKeys",
        order: 1,
        section: "security/alwaysEncryptedKeys/columnEncryptionKeys",
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
