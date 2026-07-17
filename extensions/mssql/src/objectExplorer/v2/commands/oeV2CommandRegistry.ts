/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 command registrations (OE_V1_PARITY_PLAN §2.4, K4): the NEW,
 * declarative registration table — separate from every classic OE
 * registration, which stays untouched. Each entry declares WHERE it appears
 * (placements: a targeting predicate over node facts → an `oe2:cmd=<flag>`
 * context value the package.json `when` clause matches, plus the menu group)
 * and HOW it runs (legacyRedirect through the handoff library, or a native
 * handler). A command may carry several placements because v1 files the same
 * command under different groups per node kind (e.g. Restore lives in
 * 3_MSSQL_instanceDatabaseActions on servers but 4_MSSQL_databaseMaintenance
 * on databases). Menu groups reuse the CLASSIC group ids so ordering and
 * separators render identically to OE v1 (the drop-in parity mission).
 * `generateMenuContributions()` is the single source for the package.json
 * menu block — a conformance test pins the shipped JSON against it, so
 * targeting can never drift from the manifest.
 */

import { OeV2Node } from "../tree/oeV2Node";

/** The node facts targeting predicates may consult (pure data). */
export interface OeV2CommandTargetFacts {
    readonly kind: OeV2Node["kind"];
    /** Set for database nodes AND DB-scoped top-level connections. */
    readonly database?: string;
    /** Set for object nodes (table/view/procedure/…). */
    readonly objectKind?: string;
    /** Docker container connection (profile carries containerName, DOCK-2). */
    readonly isContainer?: boolean;
}

export interface OeV2CommandPlacement {
    /** Context-value flag: `oe2:cmd=<flag>` (word-boundary matched). */
    readonly flag: string;
    /** package.json view/item/context group (classic group ids for parity). */
    readonly menuGroup: string;
    readonly appliesTo: (facts: OeV2CommandTargetFacts) => boolean;
    /** Extra manifest when-clause (context keys), ANDed onto the generated one. */
    readonly extraWhen?: string;
}

export interface OeV2CommandDef {
    /** Command id registered with VS Code. */
    readonly id: string;
    readonly title: string;
    /** Policy feature key (legacyRedirect routes) or native handler key. */
    readonly feature: string;
    readonly route: "legacyRedirect" | "native";
    readonly placements: readonly OeV2CommandPlacement[];
}

// v1 gate translations (classic `type=`/`subType=` regexes → node facts).
const serverScoped = (facts: OeV2CommandTargetFacts) =>
    facts.kind === "connectedServer" && facts.database === undefined;
const dbScopedConnection = (facts: OeV2CommandTargetFacts) =>
    facts.kind === "connectedServer" && facts.database !== undefined;
/** v1 `type=Database || subType=(Database|DockerContainerDatabase)`. */
const databaseish = (facts: OeV2CommandTargetFacts) =>
    facts.kind === "database" || dbScopedConnection(facts);
const anyConnectedServer = (facts: OeV2CommandTargetFacts) => facts.kind === "connectedServer";
const tableObject = (facts: OeV2CommandTargetFacts) =>
    facts.kind === "object" && facts.objectKind === "table";

const COPILOT_INSTALLED = "mssql.copilot.isGHCInstalled";

export const OE_V2_COMMANDS: readonly OeV2CommandDef[] = [
    // ------------------------------------------------------------- 1_primary
    {
        id: "mssql.objectExplorerV2.newQuery",
        // Sanctioned deviation from v1's "New Query": a different command
        // (opens Query Studio) keeps its own name.
        title: "New Query (Query Studio)",
        feature: "newQuery",
        route: "native",
        placements: [
            {
                flag: "newQuery",
                menuGroup: "1_MSSQL_primary@1",
                appliesTo: (facts) =>
                    anyConnectedServer(facts) || facts.kind === "database" || tableObject(facts),
            },
        ],
    },
    // -------------------------------------------------------- 2b_tableActions
    {
        id: "mssql.objectExplorerV2.editTableData",
        title: "Edit Table Data...",
        feature: "tableExplorer",
        route: "legacyRedirect",
        placements: [
            { flag: "editTableData", menuGroup: "2b_MSSQL_tableActions@1", appliesTo: tableObject },
        ],
    },
    {
        id: "mssql.objectExplorerV2.editTable",
        title: "Modify Table Structure...",
        feature: "editTable",
        route: "legacyRedirect",
        placements: [
            { flag: "editTable", menuGroup: "2b_MSSQL_tableActions@2", appliesTo: tableObject },
        ],
    },
    // ------------------------------------------------------ 2a_databaseDesign
    {
        id: "mssql.objectExplorerV2.schemaDesigner",
        title: "Visualize and Design Schema...",
        feature: "schemaDesigner",
        route: "legacyRedirect",
        placements: [
            {
                flag: "schemaDesigner",
                menuGroup: "2a_MSSQL_databaseDesign@1",
                appliesTo: databaseish,
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.buildDataApi",
        title: "Build Data API...",
        feature: "buildDataApi",
        route: "legacyRedirect",
        placements: [
            {
                flag: "buildDataApi",
                menuGroup: "2a_MSSQL_databaseDesign@2",
                appliesTo: databaseish,
            },
        ],
    },
    // ------------------------------------------- 3_discover / 4_discoverProfile
    {
        id: "mssql.objectExplorerV2.search",
        // v1 wording: the native metadata-store search fully replaces the
        // classic Search Database Objects dialog on database contexts.
        title: "Search Database Objects...",
        feature: "search",
        route: "native",
        placements: [
            { flag: "search", menuGroup: "3_MSSQL_databaseDiscover@1", appliesTo: databaseish },
        ],
    },
    {
        id: "mssql.objectExplorerV2.launchProfiler",
        title: "Launch Query Profiler...",
        feature: "profiler",
        route: "legacyRedirect",
        placements: [
            {
                flag: "profiler",
                menuGroup: "4_MSSQL_discoverAndProfile@2",
                appliesTo: serverScoped,
            },
            {
                flag: "profilerDb",
                menuGroup: "3_MSSQL_databaseDiscover@2",
                appliesTo: databaseish,
            },
        ],
    },
    // ------------------------------------- 3_instanceActions / 4_maintenance
    {
        id: "mssql.objectExplorerV2.renameDatabase",
        title: "Rename Database...",
        feature: "renameDatabase",
        route: "legacyRedirect",
        placements: [
            // v1 gates rename/drop on strict type=Database (never a DB-scoped
            // top-level connection).
            {
                flag: "renameDatabase",
                menuGroup: "4_MSSQL_databaseMaintenance@1",
                appliesTo: (facts) => facts.kind === "database",
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.backupDatabase",
        title: "Backup Database...",
        feature: "backupDatabase",
        route: "legacyRedirect",
        placements: [
            // K4: database nodes (nested) + DB-scoped TOP-LEVEL connections —
            // never a server-scoped connection node.
            { flag: "backup", menuGroup: "4_MSSQL_databaseMaintenance@2", appliesTo: databaseish },
        ],
    },
    {
        id: "mssql.objectExplorerV2.restoreDatabase",
        title: "Restore Database...",
        feature: "restoreDatabase",
        route: "legacyRedirect",
        placements: [
            {
                flag: "restore",
                menuGroup: "3_MSSQL_instanceDatabaseActions@3",
                appliesTo: serverScoped,
            },
            {
                flag: "restoreDb",
                menuGroup: "4_MSSQL_databaseMaintenance@3",
                appliesTo: databaseish,
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.importData",
        title: "Import Data...",
        feature: "flatFileImport",
        route: "legacyRedirect",
        placements: [
            {
                flag: "importDataSrv",
                menuGroup: "3_MSSQL_instanceDatabaseActions@4",
                appliesTo: serverScoped,
            },
            {
                flag: "importData",
                menuGroup: "4_MSSQL_databaseMaintenance@4",
                appliesTo: databaseish,
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.dropDatabase",
        title: "Drop Database...",
        feature: "dropDatabase",
        route: "legacyRedirect",
        placements: [
            {
                flag: "dropDatabase",
                menuGroup: "4_MSSQL_databaseMaintenance@5",
                appliesTo: (facts) => facts.kind === "database",
            },
        ],
    },
    // -------------------------------------------------- 2_connection extras
    {
        id: "mssql.objectExplorerV2.copyConnectionString",
        title: "Copy Connection String",
        feature: "copyConnectionString",
        route: "legacyRedirect",
        placements: [
            {
                flag: "copyConnectionString",
                menuGroup: "2_MSSQL_connection@4",
                appliesTo: (facts) =>
                    facts.kind === "connectedServer" || facts.kind === "disconnectedConnection",
            },
        ],
    },
    // ------------------------------------------------------------ 6_copilot
    {
        id: "mssql.objectExplorerV2.chatWithDatabase",
        title: "Open in GitHub Copilot Chat",
        feature: "chatWithDatabase",
        route: "legacyRedirect",
        placements: [
            {
                flag: "copilotChat",
                menuGroup: "6_MSSQL_copilot@1",
                appliesTo: (facts) =>
                    anyConnectedServer(facts) || facts.kind === "database" || tableObject(facts),
                extraWhen: COPILOT_INSTALLED,
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.chatWithDatabaseAgent",
        title: "Open in GitHub Copilot Agent",
        feature: "chatWithDatabaseAgent",
        route: "legacyRedirect",
        placements: [
            {
                flag: "copilotAgent",
                menuGroup: "6_MSSQL_copilot@2",
                appliesTo: (facts) =>
                    anyConnectedServer(facts) || facts.kind === "database" || tableObject(facts),
                extraWhen: COPILOT_INSTALLED,
            },
        ],
    },
    // -------------------------------------------------- 7_compareAndDacpac
    {
        id: "mssql.objectExplorerV2.schemaCompare",
        title: "Compare Schemas...",
        feature: "schemaCompare",
        route: "legacyRedirect",
        placements: [
            {
                flag: "schemaCompare",
                menuGroup: "7_MSSQL_compareAndDacpac@1",
                appliesTo: (facts) => anyConnectedServer(facts) || facts.kind === "database",
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.dacpacDialog",
        title: "DACPAC/BACPAC Operations...",
        feature: "dacpacDialog",
        route: "legacyRedirect",
        placements: [
            {
                flag: "dacpac",
                menuGroup: "7_MSSQL_compareAndDacpac@2",
                appliesTo: (facts) => anyConnectedServer(facts) || facts.kind === "database",
            },
        ],
    },
    // ------------------------------------------- 8_sqlProjectsAndNotebooks
    {
        id: "mssql.objectExplorerV2.newNotebook",
        title: "New SQL Notebook",
        feature: "createNotebook",
        route: "legacyRedirect",
        placements: [
            {
                flag: "newNotebook",
                menuGroup: "8_MSSQL_sqlProjectsAndNotebooks@2",
                appliesTo: (facts) => anyConnectedServer(facts) || facts.kind === "database",
            },
        ],
    },
    // Docker container lifecycle (DOCK-2): v1 wording, v1 node-state gates
    // (start on stopped, stop on connected, delete on both), native route
    // over the shared docker core.
    {
        id: "mssql.objectExplorerV2.startContainer",
        title: "Start SQL Container",
        feature: "startContainer",
        route: "native",
        placements: [
            {
                flag: "startContainer",
                menuGroup: "9_MSSQL_container@1",
                appliesTo: (facts) =>
                    facts.isContainer === true &&
                    (facts.kind === "disconnectedConnection" || facts.kind === "lostConnection"),
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.stopContainer",
        title: "Stop SQL Container",
        feature: "stopContainer",
        route: "native",
        placements: [
            {
                flag: "stopContainer",
                menuGroup: "9_MSSQL_container@2",
                appliesTo: (facts) =>
                    facts.isContainer === true && facts.kind === "connectedServer",
            },
        ],
    },
    {
        id: "mssql.objectExplorerV2.deleteContainer",
        title: "Delete SQL Container",
        feature: "deleteContainer",
        route: "native",
        placements: [
            {
                flag: "deleteContainer",
                menuGroup: "9_MSSQL_container@3",
                appliesTo: (facts) =>
                    facts.isContainer === true &&
                    (facts.kind === "disconnectedConnection" ||
                        facts.kind === "connectedServer" ||
                        facts.kind === "lostConnection"),
            },
        ],
    },
];

/** Context-value command flags for a node (rides nodeContextValue). */
export function commandFlagsFor(facts: OeV2CommandTargetFacts): string[] {
    const flags: string[] = [];
    for (const def of OE_V2_COMMANDS) {
        for (const placement of def.placements) {
            if (placement.appliesTo(facts)) {
                flags.push(`oe2:cmd=${placement.flag}`);
            }
        }
    }
    return flags;
}

export interface GeneratedMenuContribution {
    readonly command: string;
    readonly when: string;
    readonly group: string;
}

/** The authoritative view/item/context entries (conformance-tested). */
export function generateMenuContributions(): GeneratedMenuContribution[] {
    return OE_V2_COMMANDS.flatMap((def) =>
        def.placements.map((placement) => ({
            command: def.id,
            when:
                `view == mssql.objectExplorerV2 && viewItem =~ /\\boe2:cmd=${placement.flag}\\b/` +
                (placement.extraWhen ? ` && ${placement.extraWhen}` : ""),
            group: placement.menuGroup,
        })),
    );
}

/**
 * The node-extraction contract (K-cross): everything a command handler may
 * need from the invoked node, in one place. Handlers take THIS, never raw
 * tree items.
 */
export interface OeV2CommandTarget {
    readonly node: OeV2Node;
    readonly kind: OeV2Node["kind"];
    readonly connectionId?: string;
    readonly database?: string;
    readonly schema?: string;
    readonly objectName?: string;
}

export function commandTargetFor(node: OeV2Node): OeV2CommandTarget {
    return {
        node,
        kind: node.kind,
        ...(node.connectionId !== undefined ? { connectionId: node.connectionId } : {}),
        ...(node.database !== undefined ? { database: node.database } : {}),
        ...(node.schema !== undefined ? { schema: node.schema } : {}),
        ...(node.objectName !== undefined ? { objectName: node.objectName } : {}),
    };
}
