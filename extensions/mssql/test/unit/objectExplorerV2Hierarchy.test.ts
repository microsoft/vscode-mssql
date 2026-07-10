/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B22 (OE_V1_PARITY_PLAN): hierarchy registry resolution + v1 label/tooltip
 * parity. The label recipe is pinned AGAINST the classic implementation
 * (models/connectionInfo.getConnectionDisplayName) so drift in either copy
 * fails here, not in a dogfood session.
 */

import { expect } from "chai";
import { getConnectionDisplayName } from "../../src/models/connectionInfo";
import { IConnectionInfo } from "vscode-mssql";
import {
    connectionDisplayLabel,
    connectionTooltipLines,
    disambiguationLines,
    OeV2ConnectionLabelFacts,
} from "../../src/objectExplorer/v2/tree/oeV2ConnectionLabel";
import {
    isSystemDatabaseName,
    OeV2FolderDef,
    resolveFolders,
} from "../../src/objectExplorer/v2/tree/oeV2Hierarchy";
import { childrenOfGroup } from "../../src/objectExplorer/v2/tree/oeV2NodeFactory";
import {
    databaseFolderChildren,
    objectChildren,
    OeV2AuxAccess,
    OeV2AuxItemFacts,
    serverAuxFolderChildren,
    serverChildren,
} from "../../src/objectExplorer/v2/tree/oeV2Browse";
import { decodePath, encodePath } from "../../src/objectExplorer/v2/tree/oeV2Path";
import { OeV2ProfileTree } from "../../src/objectExplorer/v2/sessions/oeV2ProfileAdapter";
import type { CatalogSnapshot } from "../../src/services/metadata/catalogModel";

suite("Object Explorer v2 hierarchy registry (B22)", () => {
    test("database scope resolves the SSMS top-level layout (B24)", () => {
        const folders = resolveFolders("database", {});
        expect(folders.map((def) => def.label)).to.deep.equal([
            "Tables",
            "Views",
            "Synonyms",
            "Programmability",
            "Service Broker",
            "Storage",
            "Security",
        ]);
        // Programmability nests the object folders + aux leaves in SSMS order.
        expect(
            resolveFolders("database", {}, { parentId: "programmability" }).map((def) => def.label),
        ).to.deep.equal([
            "Stored Procedures",
            "Functions",
            "Database Triggers",
            "Assemblies",
            "Types",
            "Sequences",
        ]);
        expect(
            resolveFolders("database", {}, { parentId: "dbSecurity" }).map((def) => def.label),
        ).to.deep.equal([
            "Users",
            "Roles",
            "Schemas",
            "Asymmetric Keys",
            "Certificates",
            "Symmetric Keys",
            "Database Scoped Credentials",
            "Database Audit Specifications",
            "Security Policies",
            "Always Encrypted Keys",
        ]);
        // Azure hides Service Broker (STS ValidFor).
        expect(
            resolveFolders("database", { isAzure: true }).map((def) => def.label),
        ).to.not.include("Service Broker");
    });

    test("server scope resolves Databases, Security, Server Objects (B23)", () => {
        expect(resolveFolders("server", {}).map((def) => def.id)).to.deep.equal([
            "databases",
            "security",
            "serverObjects",
        ]);
    });

    test("gates: validFor, system-folder stripping, nonEmpty presence, sortLast", () => {
        const registry: OeV2FolderDef[] = [
            { id: "plain", label: "Plain", scope: "database", order: 1, section: "s" },
            {
                id: "sys",
                label: "System Things",
                scope: "database",
                order: 0,
                section: "s",
                isSystemFolder: true,
            },
            {
                id: "modern",
                label: "Modern Only",
                scope: "database",
                order: 2,
                section: "s",
                validFor: (facts) => (facts.serverMajorVersion ?? 0) >= 16,
            },
            {
                id: "droppedLedger",
                label: "Dropped Ledger Tables",
                scope: "database",
                order: 0,
                section: "s",
                presence: "nonEmpty",
                sortLast: true,
            },
            {
                id: "child",
                label: "Nested",
                scope: "database",
                order: 0,
                section: "s",
                parentId: "plain",
            },
        ];
        // User database, old server, no dropped-ledger rows: only "plain".
        expect(
            resolveFolders(
                "database",
                { isSystemDatabase: false, serverMajorVersion: 15 },
                { hasItems: (def) => def.id !== "droppedLedger" },
                registry,
            ).map((def) => def.id),
        ).to.deep.equal(["plain"]);
        // System database on 2022 with rows: everything, dropped-ledger LAST
        // despite order 0.
        expect(
            resolveFolders(
                "database",
                { isSystemDatabase: true, serverMajorVersion: 16 },
                { hasItems: () => true },
                registry,
            ).map((def) => def.id),
        ).to.deep.equal(["sys", "plain", "modern", "droppedLedger"]);
        // Nested folders resolve under their parent only.
        expect(
            resolveFolders("database", {}, { parentId: "plain" }, registry).map((def) => def.id),
        ).to.deep.equal(["child"]);
    });

    test("system database names match the STS rule", () => {
        for (const name of ["master", "Model", "MSDB", "tempdb"]) {
            expect(isSystemDatabaseName(name), name).to.equal(true);
        }
        expect(isSystemDatabaseName("AdventureWorks")).to.equal(false);
        expect(isSystemDatabaseName(undefined)).to.equal(false);
    });

    test("path codec: nested folder ids with '/' round-trip", () => {
        const path = {
            kind: "serverFolder" as const,
            connectionId: "p1",
            folder: "security/logins",
        };
        expect(decodePath(encodePath(path))).to.deep.equal(path);
        const dbPath = {
            kind: "databaseFolder" as const,
            connectionId: "p1",
            database: "Db",
            folder: "programmability/storedProcedures",
        };
        expect(decodePath(encodePath(dbPath))).to.deep.equal(dbPath);
    });
});

suite("Object Explorer v2 connection labels (B22 / K6)", () => {
    const CASES: { name: string; profile: OeV2ConnectionLabelFacts }[] = [
        {
            name: "profileName wins",
            profile: { profileName: "Prod East", server: "srv", database: "AppDb" },
        },
        {
            name: "SqlLogin shows user",
            profile: {
                server: "localhost",
                database: "AppDb",
                authenticationType: "SqlLogin",
                user: "sa",
            },
        },
        {
            name: "AzureMFA shows email",
            profile: {
                server: "srv.database.windows.net",
                database: "AppDb",
                authenticationType: "AzureMFA",
                email: "karl@contoso.com",
            },
        },
        {
            name: "Integrated shows auth type",
            profile: { server: "localhost", authenticationType: "Integrated" },
        },
        {
            name: "empty database renders <default>",
            profile: { server: "localhost", database: "", authenticationType: "Integrated" },
        },
    ];

    test("label recipe matches classic getConnectionDisplayName", () => {
        for (const testCase of CASES) {
            expect(connectionDisplayLabel(testCase.profile), testCase.name).to.equal(
                getConnectionDisplayName(testCase.profile as unknown as IConnectionInfo),
            );
        }
    });

    test("tooltip lists non-default properties in classic order and wording", () => {
        const lines = connectionTooltipLines({
            profileName: "Prod East",
            server: "localhost",
            database: "AppDb",
            authenticationType: "Integrated",
            user: "ignored-for-integrated",
            port: 1433,
            connectTimeout: 30, // real default — omitted
            commandTimeout: 60,
            alwaysEncrypted: true,
        });
        expect(lines).to.deep.equal([
            "Prod East",
            "Server: localhost",
            "Database: AppDb",
            "Authentication Type: Windows Authentication",
            "Port: 1433",
            "Command Timeout: 60",
            "Always Encrypted: Enabled",
        ]);
    });

    test("sql-auth tooltip keeps the user line and hides default auth type", () => {
        const lines = connectionTooltipLines({
            server: "srv",
            authenticationType: "SqlLogin",
            user: "sa",
        });
        expect(lines).to.deep.equal(["Server: srv", "User: sa"]);
    });

    test("disambiguation: tied labels surface the differing properties", () => {
        const a = { server: "srv", authenticationType: "Integrated", port: 1433 };
        const b = { server: "srv", authenticationType: "Integrated", port: 1533 };
        expect(disambiguationLines(a, [b])).to.deep.equal(["Port: 1433"]);
        expect(disambiguationLines(b, [a])).to.deep.equal(["Port: 1533"]);
        // identical facts → nothing to distinguish
        expect(disambiguationLines(a, [a])).to.deep.equal([]);
    });

    test("factory appends disambiguation only to tied siblings", () => {
        const stored = (port: number) => ({
            server: "srv",
            authenticationType: "Integrated" as const,
            port,
        });
        const tree: OeV2ProfileTree = {
            groups: [],
            profiles: [
                {
                    profileId: "a",
                    displayName: "srv, <default> (Integrated)",
                    server: "srv",
                    authKind: "integrated",
                    stored: stored(1433),
                },
                {
                    profileId: "b",
                    displayName: "srv, <default> (Integrated)",
                    server: "srv",
                    authKind: "integrated",
                    stored: stored(1533),
                },
                {
                    profileId: "c",
                    displayName: "other, <default> (Integrated)",
                    server: "other",
                    authKind: "integrated",
                    stored: { server: "other", authenticationType: "Integrated" },
                },
            ],
        };
        const nodes = childrenOfGroup(tree, undefined);
        const tiedTooltips = nodes
            .filter((node) => node.label === "srv, <default> (Integrated)")
            .map((node) => node.tooltip ?? "");
        expect(tiedTooltips).to.have.length(2);
        expect(tiedTooltips[0]).to.include("Differs from same-named connections:");
        expect(tiedTooltips[0]).to.include("Port: 1433");
        expect(tiedTooltips[1]).to.include("Port: 1533");
        const untied = nodes.find((node) => node.label === "other, <default> (Integrated)");
        expect(untied?.tooltip ?? "").to.not.include("Differs");
    });
});

suite("Object Explorer v2 server-level folders (B23)", () => {
    test("server-scoped connection renders Databases, Security, Server Objects in order", () => {
        expect(serverChildren("c1", {}).map((n) => n.label)).to.deep.equal([
            "Databases",
            "Security",
            "Server Objects",
        ]);
    });

    test("K1: database-scoped connection renders Databases only", () => {
        expect(
            serverChildren("c1", { databaseScopedConnection: true }).map((n) => n.label),
        ).to.deep.equal(["Databases"]);
    });

    test("Azure hides Server Objects (STS AllOnPrem) and on-prem-only security leaves", () => {
        expect(serverChildren("c1", { isAzure: true }).map((n) => n.label)).to.deep.equal([
            "Databases",
            "Security",
        ]);
        const security = serverAuxFolderChildren(
            "c1",
            "security",
            { isAzure: true },
            undefined,
            undefined,
        );
        expect(security.map((n) => n.label)).to.deep.equal(["Logins", "Server Roles"]);
    });

    test("parent folder renders registry children without any section state", () => {
        const security = serverAuxFolderChildren("c1", "security", {}, undefined, undefined);
        expect(security.map((n) => n.label)).to.deep.equal([
            "Logins",
            "Server Roles",
            "Credentials",
            "Cryptographic Providers",
            "Server Audits",
            "Server Audit Specifications",
        ]);
        expect(security.every((n) => n.kind === "serverFolder")).to.equal(true);
    });

    test("aux leaf honesty: loading, failed, empty, ready with disabled badges", () => {
        const loading = serverAuxFolderChildren("c1", "security/logins", {}, undefined, undefined);
        expect(loading[0].kind).to.equal("loading");
        const failed = serverAuxFolderChildren(
            "c1",
            "security/logins",
            {},
            { readiness: "failed", errorMessage: "boom" },
            undefined,
        );
        expect(failed[0].kind).to.equal("error");
        expect(failed[0].label).to.include("boom");
        const empty = serverAuxFolderChildren(
            "c1",
            "security/credentials",
            {},
            { readiness: "ready" },
            [],
        );
        expect(empty[0].kind).to.equal("noItems");
        const ready = serverAuxFolderChildren("c1", "security/logins", {}, { readiness: "ready" }, [
            { name: "appLogin", isSystem: false },
            { name: "oldLogin", isSystem: false, subType: "disabled" },
        ]);
        expect(ready.map((n) => `${n.label}:${n.icon}`)).to.deep.equal([
            "appLogin:ServerLevelLogin",
            "oldLogin:ServerLevelLogin_Disabled",
        ]);
        expect(ready[1].description).to.equal("disabled");
        expect(ready.every((n) => n.kind === "serverObject" && n.collapsible === false)).to.equal(
            true,
        );
    });

    test("unknown server folder id is an explicit stale-folder error", () => {
        const nodes = serverAuxFolderChildren("c1", "security/nonsense", {}, undefined, undefined);
        expect(nodes[0].kind).to.equal("error");
    });

    test("path codec: serverObjectItem round-trips", () => {
        const path = {
            kind: "serverObjectItem" as const,
            connectionId: "c1",
            folder: "security/logins",
            name: "CONTOSO\svc account",
        };
        expect(decodePath(encodePath(path))).to.deep.equal(path);
    });
});

suite("Object Explorer v2 database parity (B24)", () => {
    // Minimal structural snapshot: only the members databaseFolderChildren touches.
    function fakeSnapshot(
        objects: { objectId: number; schema: string; name: string; kind: string }[],
    ): CatalogSnapshot {
        return {
            readiness: { objects: "ready", synonyms: "ready", schemas: "ready" },
            listObjects: (schema?: string, kinds?: string[]) =>
                objects.filter(
                    (o) =>
                        (schema === undefined || o.schema === schema) &&
                        (kinds === undefined || kinds.includes(o.kind)),
                ),
            listSchemas: () => [{ name: "dbo" }],
        } as unknown as CatalogSnapshot;
    }
    const READY = { readiness: "ready" } as unknown as Parameters<typeof databaseFolderChildren>[3];

    function auxOf(
        sections: Record<string, { items?: OeV2AuxItemFacts[]; failed?: boolean }>,
    ): OeV2AuxAccess {
        return {
            status: (key: string) => {
                const section = sections[key];
                if (!section) {
                    return undefined;
                }
                return section.failed
                    ? { readiness: "failed", errorMessage: "denied" }
                    : { readiness: "ready" };
            },
            items: (key: string) => sections[key]?.items,
        };
    }

    const TABLES = [
        { objectId: 1, schema: "dbo", name: "Orders", kind: "table" },
        { objectId: 2, schema: "dbo", name: "OrdersHistory", kind: "table" },
        { objectId: 3, schema: "dbo", name: "Ledger", kind: "table" },
        { objectId: 4, schema: "dbo", name: "DroppedThing", kind: "table" },
    ];
    const FACETS: Record<string, { items?: OeV2AuxItemFacts[] }> = {
        tableFacets: {
            items: [
                {
                    name: "Orders",
                    schema: "dbo",
                    kind: "table",
                    isSystem: false,
                    objectId: 1,
                    facts: { temporalType: 2, historyTableId: 2 },
                },
                {
                    name: "OrdersHistory",
                    schema: "dbo",
                    kind: "table",
                    isSystem: false,
                    objectId: 2,
                    facts: { temporalType: 1 },
                },
                {
                    name: "Ledger",
                    schema: "dbo",
                    kind: "table",
                    isSystem: false,
                    objectId: 3,
                    facts: { ledgerType: 3 },
                },
                {
                    name: "DroppedThing",
                    schema: "dbo",
                    kind: "table",
                    isSystem: false,
                    objectId: 4,
                    facts: { isDroppedLedger: 1 },
                },
            ],
        },
    };

    test("K3: history/dropped excluded, suffixes + subtype icons, Dropped Ledger folder last", () => {
        const nodes = databaseFolderChildren(
            "c1",
            "AppDb",
            "tables",
            READY,
            fakeSnapshot(TABLES),
            false,
            undefined,
            undefined,
            {},
            auxOf(FACETS),
        );
        expect(nodes.map((n) => n.label)).to.deep.equal([
            "dbo.Orders (System-Versioned)",
            "dbo.Ledger (Append-Only Ledger)",
            "Dropped Ledger Tables",
        ]);
        expect(nodes[0].icon).to.equal("Table_Temporal");
        expect(nodes[1].icon).to.equal("Table_Ledger");
        expect(nodes[2].kind).to.equal("databaseFolder");
        // Dropped Ledger folder contents render the dropped rows only.
        const dropped = databaseFolderChildren(
            "c1",
            "AppDb",
            "tables/droppedLedgerTables",
            READY,
            fakeSnapshot(TABLES),
            false,
            undefined,
            undefined,
            {},
            auxOf(FACETS),
        );
        expect(dropped.map((n) => `${n.label}:${n.icon}`)).to.deep.equal([
            "dbo.DroppedThing:Table_LedgerHistory",
        ]);
    });

    test("K3: no facets yet renders flat with NO dropped-ledger folder (no empty folders)", () => {
        const nodes = databaseFolderChildren(
            "c1",
            "AppDb",
            "tables",
            READY,
            fakeSnapshot(TABLES),
            false,
            undefined,
            undefined,
            {},
            auxOf({}),
        );
        expect(nodes.map((n) => n.label)).to.deep.equal([
            "dbo.Orders",
            "dbo.OrdersHistory",
            "dbo.Ledger",
            "dbo.DroppedThing",
        ]);
    });

    test("K2: System Tables folder + system objects only in system-database context", () => {
        const aux = auxOf({
            systemObjects: {
                items: [
                    { name: "systhing", schema: "sys", kind: "table", isSystem: true },
                    { name: "sysproc", schema: "sys", kind: "procedure", isSystem: true },
                ],
            },
            tableFacets: { items: [] },
        });
        const inMaster = databaseFolderChildren(
            "c1",
            "master",
            "tables",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            { isSystemDatabase: true },
            aux,
        );
        expect(inMaster[0].label).to.equal("System Tables");
        const systemTables = databaseFolderChildren(
            "c1",
            "master",
            "tables/systemTables",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            { isSystemDatabase: true },
            aux,
        );
        expect(systemTables.map((n) => n.label)).to.deep.equal(["sys.systhing"]);
        const inUserDb = databaseFolderChildren(
            "c1",
            "AppDb",
            "tables",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            { isSystemDatabase: false },
            aux,
        );
        expect(inUserDb.every((n) => n.label !== "System Tables")).to.equal(true);
    });

    test("aux leaves: disabled badge, hideSystemItems by database context, failure honesty", () => {
        const aux = auxOf({
            "programmability/databaseTriggers": {
                items: [{ name: "trgAudit", isSystem: false, subType: "disabled" }],
            },
            "serviceBroker/messageTypes": {
                items: [
                    { name: "MyMessage", isSystem: false },
                    { name: "DEFAULT", isSystem: true },
                ],
            },
            "security/users": { failed: true },
        });
        const triggers = databaseFolderChildren(
            "c1",
            "AppDb",
            "programmability/databaseTriggers",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            {},
            aux,
        );
        expect(triggers[0].label).to.equal("trgAudit");
        expect(triggers[0].description).to.equal("disabled");
        expect(triggers[0].icon).to.equal("Trigger_Disabled");
        const userDbTypes = databaseFolderChildren(
            "c1",
            "AppDb",
            "serviceBroker/messageTypes",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            { isSystemDatabase: false },
            aux,
        );
        expect(userDbTypes.map((n) => n.label)).to.deep.equal(["MyMessage"]);
        const masterTypes = databaseFolderChildren(
            "c1",
            "master",
            "serviceBroker/messageTypes",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            { isSystemDatabase: true },
            aux,
        );
        expect(masterTypes.map((n) => n.label)).to.deep.equal(["MyMessage", "DEFAULT"]);
        const users = databaseFolderChildren(
            "c1",
            "AppDb",
            "security/users",
            READY,
            fakeSnapshot([]),
            false,
            undefined,
            undefined,
            {},
            aux,
        );
        expect(users[0].kind).to.equal("error");
        expect(users[0].label).to.include("denied");
    });

    test("K3: history table nests under its parent, before the child folders", () => {
        const children = objectChildren(
            {
                kind: "object",
                connectionId: "c1",
                database: "AppDb",
                schema: "dbo",
                name: "Orders",
                objectKind: "table",
            },
            { schema: "dbo", name: "OrdersHistory" },
        );
        expect(children.map((n) => n.label)).to.deep.equal([
            "dbo.OrdersHistory (History)",
            "Columns",
            "Keys",
            "Foreign Keys",
        ]);
        expect(children[0].icon).to.equal("HistoryTable");
        expect(children[0].collapsible).to.equal(true);
    });

    test("path codec: databaseObjectItem round-trips", () => {
        const path = {
            kind: "databaseObjectItem" as const,
            connectionId: "c1",
            database: "App/Db",
            folder: "security/users",
            name: "dbo.some user",
        };
        expect(decodePath(encodePath(path))).to.deep.equal(path);
    });
});
