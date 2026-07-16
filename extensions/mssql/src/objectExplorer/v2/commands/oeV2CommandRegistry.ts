/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 command registrations (OE_V1_PARITY_PLAN §2.4, K4): the NEW,
 * declarative registration table — separate from every classic OE
 * registration, which stays untouched. Each entry declares WHERE it appears
 * (a targeting predicate over node facts → an `oe2:cmd=<flag>` context
 * value the package.json `when` clause matches) and HOW it runs
 * (legacyRedirect through the handoff library, or a native handler).
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
}

export interface OeV2CommandDef {
    /** Command id registered with VS Code. */
    readonly id: string;
    readonly title: string;
    /** Policy feature key (legacyRedirect routes) or native handler key. */
    readonly feature: string;
    readonly route: "legacyRedirect" | "native";
    /** Context-value flag: `oe2:cmd=<flag>` (word-boundary matched). */
    readonly flag: string;
    /** package.json view/item/context group. */
    readonly menuGroup: string;
    readonly appliesTo: (facts: OeV2CommandTargetFacts) => boolean;
}

export const OE_V2_COMMANDS: readonly OeV2CommandDef[] = [
    {
        id: "mssql.objectExplorerV2.backupDatabase",
        // Dogfood #8: v1 wording on the same nodes — drop-in parity.
        title: "Backup Database...",
        feature: "backupDatabase",
        route: "legacyRedirect",
        flag: "backup",
        menuGroup: "2_MSSQL_admin@1",
        // K4: database nodes (nested) + DB-scoped TOP-LEVEL connections —
        // never a server-scoped connection node.
        appliesTo: (facts) =>
            facts.kind === "database" ||
            (facts.kind === "connectedServer" && facts.database !== undefined),
    },
    {
        id: "mssql.objectExplorerV2.restoreDatabase",
        title: "Restore Database...",
        feature: "restoreDatabase",
        route: "legacyRedirect",
        flag: "restore",
        menuGroup: "2_MSSQL_admin@2",
        // K4: servers (top-level connections, DB-scoped or not) + databases.
        appliesTo: (facts) => facts.kind === "connectedServer" || facts.kind === "database",
    },
    {
        id: "mssql.objectExplorerV2.launchProfiler",
        title: "Launch Query Profiler...",
        feature: "profiler",
        route: "legacyRedirect",
        flag: "profiler",
        menuGroup: "2_MSSQL_admin@3",
        appliesTo: (facts) => facts.kind === "connectedServer" || facts.kind === "database",
    },
    {
        id: "mssql.objectExplorerV2.schemaCompare",
        title: "Compare Schemas...",
        feature: "schemaCompare",
        route: "legacyRedirect",
        flag: "schemaCompare",
        menuGroup: "2_MSSQL_admin@4",
        appliesTo: (facts) => facts.kind === "database",
    },
    {
        id: "mssql.objectExplorerV2.editTable",
        title: "Modify Table Structure...",
        feature: "editTable",
        route: "legacyRedirect",
        flag: "editTable",
        menuGroup: "2_MSSQL_admin@0",
        appliesTo: (facts) => facts.kind === "object" && facts.objectKind === "table",
    },
];

/** Context-value command flags for a node (rides nodeContextValue). */
export function commandFlagsFor(facts: OeV2CommandTargetFacts): string[] {
    return OE_V2_COMMANDS.filter((def) => def.appliesTo(facts)).map((def) => `oe2:cmd=${def.flag}`);
}

export interface GeneratedMenuContribution {
    readonly command: string;
    readonly when: string;
    readonly group: string;
}

/** The authoritative view/item/context entries (conformance-tested). */
export function generateMenuContributions(): GeneratedMenuContribution[] {
    return OE_V2_COMMANDS.map((def) => ({
        command: def.id,
        when: `view == mssql.objectExplorerV2 && viewItem =~ /\\boe2:cmd=${def.flag}\\b/`,
        group: def.menuGroup,
    }));
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
