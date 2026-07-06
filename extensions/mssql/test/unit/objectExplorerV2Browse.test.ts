/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 connect + browse (B18): data-plane sessions through the registry,
 * server catalog → Databases folder states, lazy database catalogs, object
 * folders and children over pinned snapshots, multi-database isolation,
 * section-failure honesty, stale paths, disconnect lifecycle — all under
 * the standing NO-V1 spies.
 */

import { expect } from "chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import ConnectionManager from "../../src/controllers/connectionManager";
import {
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
} from "../../src/services/sqlDataPlane/api";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { MetadataStore } from "../../src/services/metadata/metadataStore";
import { OeV2MetadataCoordinator } from "../../src/objectExplorer/v2/metadata/oeV2MetadataCoordinator";
import { OeV2SessionRegistry } from "../../src/objectExplorer/v2/sessions/oeV2SessionRegistry";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";

/** Catalog fixture: Orders/Customers + GetOrders proc + PK/UQ/FK. */
function dbScripts(tableName: string): FakeScript[] {
    return [
        {
            match: (t) => t.includes("SERVERPROPERTY"),
            events: [
                {
                    type: "resultSet",
                    columns: ["engine_edition", "default_schema", "collation_name"],
                    rows: [[5, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("CHECKSUM_AGG"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_count", "object_hash"],
                    rows: [[4, 12345]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("is_primary_key"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "name",
                        "index_name",
                        "is_primary_key",
                        "is_unique_constraint",
                    ],
                    rows: [
                        [101, "OrderId", "PK_Orders", true, false],
                        [102, "CustomerId", "PK_Customers", 1, 0],
                        [102, "Name", "UQ_Customers_Name", false, true],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("foreign_key_columns"),
            events: [
                {
                    type: "resultSet",
                    columns: ["constraint_object_id", "parent_column", "referenced_column"],
                    rows: [[900, "CustomerId", "CustomerId"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.parameters"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "parameter_id",
                        "name",
                        "type_name",
                        "max_length",
                        "precision",
                        "scale",
                        "is_output",
                    ],
                    rows: [
                        [105, 1, "@CustomerId", "int", 4, 10, 0, false],
                        [105, 2, "@Total", "decimal", 9, 18, 2, true],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.schemas"),
            events: [
                {
                    type: "resultSet",
                    columns: ["schema_id", "name"],
                    rows: [
                        [1, "dbo"],
                        [2, "sales"],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("FROM sys.objects o WHERE"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "schema_id", "name", "type", "modify_date"],
                    rows: [
                        [101, 1, tableName, "U", "2026-01-01T00:00:00"],
                        [102, 1, "Customers", "U", "2026-01-01T00:00:00"],
                        [103, 1, "OrdersView", "V", "2026-01-01T00:00:00"],
                        [105, 1, "GetOrders", "P", "2026-01-01T00:00:00"],
                        [106, 2, "Totals", "IF", "2026-01-01T00:00:00"],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.columns"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "column_id",
                        "name",
                        "type_name",
                        "max_length",
                        "precision",
                        "scale",
                        "is_nullable",
                        "is_identity",
                        "is_computed",
                    ],
                    rows: [
                        [101, 1, "OrderId", "int", 4, 10, 0, false, true, false],
                        [101, 2, "CustomerId", "int", 4, 10, 0, true, false, false],
                        [101, 3, "Total", "decimal", 9, 18, 2, true, false, true],
                        [102, 1, "CustomerId", "int", 4, 10, 0, false, true, false],
                        [102, 2, "Name", "nvarchar", 200, 0, 0, false, false, false],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.foreign_keys"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "name", "parent_object_id", "referenced_object_id"],
                    rows: [[900, "FK_Orders_Customers", 101, 102]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
    ];
}

function serverCatalogScript(databases: (string | number | boolean | null)[][]): FakeScript {
    return {
        match: (t) => t.includes("sys.databases"),
        events: [
            {
                type: "resultSet",
                columns: [
                    "database_id",
                    "name",
                    "state_desc",
                    "is_read_only",
                    "user_access_desc",
                    "compatibility_level",
                    "has_dbaccess",
                ],
                rows: databases,
            },
            { type: "complete", status: "succeeded" },
        ],
    };
}

class RoutingService implements ISqlConnectionService {
    constructor(
        private readonly byDatabase: Record<string, FakeBackend>,
        readonly fallback: FakeBackend,
    ) {}
    get availability() {
        return this.fallback.availability;
    }
    get onDidChangeAvailability() {
        return this.fallback.onDidChangeAvailability;
    }
    get backendInfo() {
        return this.fallback.backendInfo;
    }
    canOpen() {
        return this.fallback.canOpen();
    }
    openSession(params: OpenSessionParams): Promise<ISqlSession> {
        const backend = (params.database && this.byDatabase[params.database]) || this.fallback;
        return backend.openSession(params);
    }
}

interface Harness {
    controller: OeV2TreeController;
    registry: OeV2SessionRegistry;
    store: MetadataStore;
    fallback: FakeBackend;
    settings: { groupBySchema: boolean; showSystemDatabases: boolean };
}

function harness(overrides?: {
    databases?: Record<string, FakeBackend>;
    serverRows?: (string | number | boolean | null)[][];
}): Harness {
    const fallback = new FakeBackend({
        scripts: [
            serverCatalogScript(
                // Rows arrive in the query's ORDER BY name (real-wire shape).
                overrides?.serverRows ?? [
                    [5, "AppDb", "ONLINE", false, "MULTI_USER", 160, 1],
                    [7, "Locked", "ONLINE", false, "MULTI_USER", 160, 0],
                    [6, "OtherDb", "ONLINE", false, "MULTI_USER", 160, 1],
                    [1, "master", "ONLINE", false, "MULTI_USER", 160, 1],
                ],
            ),
        ],
    });
    const service = new RoutingService(
        overrides?.databases ?? {
            AppDb: new FakeBackend({ scripts: dbScripts("Orders") }),
            OtherDb: new FakeBackend({ scripts: dbScripts("Widgets") }),
        },
        fallback,
    );
    const store = new MetadataStore(async () => service, { pollSeconds: 0 });
    const registry = new OeV2SessionRegistry(async () => service);
    const settings = { groupBySchema: false, showSystemDatabases: true };
    const controller = new OeV2TreeController({
        profiles: {
            readAllConnectionGroups: async () => [{ id: "ROOT", name: "ROOT" }],
            readAllConnections: async () => [
                { id: "p1", server: "srv", profileName: "P1", groupId: "ROOT" },
            ],
        },
        secrets: { lookupPassword: async () => "" },
        dataPlane: { enabled: () => true, availabilityState: () => "available" },
        sessions: registry,
        coordinatorFactory: (prepared) => new OeV2MetadataCoordinator(store, prepared),
        settings: () => settings,
    });
    return { controller, registry, store, fallback, settings };
}

async function browseToDatabases(h: Harness): Promise<{ server: OeV2Node; dbFolder: OeV2Node }> {
    expect(await h.controller.connectProfile("p1")).to.equal(true);
    const roots = await h.controller.children();
    const server = roots.find((n) => n.kind === "connectedServer")!;
    expect(server, "connected server node").to.not.equal(undefined);
    const [dbFolder] = await h.controller.children(server);
    expect(dbFolder.label).to.equal("Databases");
    await h.controller.refreshNode(dbFolder); // awaits server-catalog hydration
    return { server, dbFolder };
}

suite("Object Explorer v2 browse (B18)", () => {
    let sendRequest: sinon.SinonSpy;
    let connect: sinon.SinonSpy;

    setup(() => {
        sendRequest = sinon.spy(SqlToolsServiceClient.prototype, "sendRequest");
        connect = sinon.spy(ConnectionManager.prototype, "connect");
    });

    teardown(() => {
        // THE TRIPWIRE: every browse test runs entirely without STS v1.
        sinon.assert.notCalled(sendRequest);
        sinon.assert.notCalled(connect);
        sendRequest.restore();
        connect.restore();
    });

    test("connect → server node; Databases folder renders catalog states honestly", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const databases = await h.controller.children(dbFolder);
        expect(databases.map((n) => n.label)).to.deep.equal([
            "AppDb",
            "Locked",
            "OtherDb",
            "master",
        ]);
        const locked = databases.find((n) => n.label === "Locked")!;
        expect(locked.collapsible).to.equal(false);
        expect(locked.readiness.kind).to.equal("permissionDenied");
        expect(locked.description).to.contain("no access");

        // system-database filter
        h.settings.showSystemDatabases = false;
        const filtered = await h.controller.children(dbFolder);
        expect(filtered.map((n) => n.label)).to.deep.equal(["AppDb", "Locked", "OtherDb"]);
        h.controller.dispose();
    });

    test("server catalog failure renders an error child, never an empty list", async () => {
        const failing = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("sys.databases"),
                    events: [
                        { type: "message", kind: "error", text: "permission denied" },
                        { type: "complete", status: "failed" },
                    ],
                },
            ],
        });
        const h = harness();
        // rebuild harness with a failing fallback
        const service = new RoutingService({}, failing);
        const store = new MetadataStore(async () => service, { pollSeconds: 0 });
        const registry = new OeV2SessionRegistry(async () => service);
        const controller = new OeV2TreeController({
            profiles: {
                readAllConnectionGroups: async () => [{ id: "ROOT", name: "ROOT" }],
                readAllConnections: async () => [
                    { id: "p1", server: "srv", profileName: "P1", groupId: "ROOT" },
                ],
            },
            secrets: { lookupPassword: async () => "" },
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
            sessions: registry,
            coordinatorFactory: (prepared) => new OeV2MetadataCoordinator(store, prepared),
            settings: () => h.settings,
        });
        expect(await controller.connectProfile("p1")).to.equal(true);
        const roots = await controller.children();
        const server = roots.find((n) => n.kind === "connectedServer")!;
        const [dbFolder] = await controller.children(server);
        await controller.refreshNode(dbFolder).catch(() => undefined);
        const children = await controller.children(dbFolder);
        expect(children).to.have.length(1);
        expect(children[0].kind).to.equal("error");
        expect(children[0].label).to.contain("Databases unavailable");
        controller.dispose();
        h.controller.dispose();
    });

    test("database → structural folders → objects, functions merge kinds, schemas list", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        const folders = await h.controller.children(appDb);
        expect(folders.map((n) => n.label)).to.deep.equal([
            "Tables",
            "Views",
            "Stored Procedures",
            "Functions",
            "Synonyms",
            "Schemas",
        ]);
        await h.controller.refreshNode(appDb); // awaits catalog hydration

        const tables = await h.controller.children(folders[0]);
        expect(tables.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        expect(tables[0].icon).to.equal("Table");
        expect(tables[0].capabilities.canPreviewTable).to.equal(true);

        const views = await h.controller.children(folders[1]);
        expect(views.map((n) => n.label)).to.deep.equal(["dbo.OrdersView"]);

        const functions = await h.controller.children(folders[3]);
        expect(functions.map((n) => n.label)).to.deep.equal(["sales.Totals"]);
        expect(functions[0].icon).to.equal("TableValuedFunction");

        const schemas = await h.controller.children(folders[5]);
        expect(schemas.map((n) => n.label)).to.deep.equal(["dbo", "sales"]);

        // group-by-schema mode inserts schema level
        h.settings.groupBySchema = true;
        const grouped = await h.controller.children(folders[0]);
        expect(grouped.map((n) => `${n.kind}:${n.label}`)).to.deep.equal(["schema:dbo"]);
        const inSchema = await h.controller.children(grouped[0]);
        expect(inSchema.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        h.controller.dispose();
    });

    test("object children: columns w/ badges, keys w/ PK+UQ, FKs w/ pairs, params w/ output", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        const folders = await h.controller.children(appDb);
        await h.controller.refreshNode(appDb);

        const orders = (await h.controller.children(folders[0])).find(
            (n) => n.label === "dbo.Orders",
        )!;
        const orderFolders = await h.controller.children(orders);
        expect(orderFolders.map((n) => n.label)).to.deep.equal(["Columns", "Keys", "Foreign Keys"]);

        const columns = await h.controller.children(orderFolders[0]);
        expect(columns.map((n) => n.label)).to.deep.equal(["OrderId", "CustomerId", "Total"]);
        expect(columns[0].description).to.contain("PK");
        expect(columns[0].description).to.contain("identity");
        expect(columns[2].description).to.contain("computed");

        const keys = await h.controller.children(orderFolders[1]);
        expect(keys.map((n) => `${n.label}:${n.icon}`)).to.deep.equal(["PK_Orders:Key_PrimaryKey"]);

        const fks = await h.controller.children(orderFolders[2]);
        expect(fks).to.have.length(1);
        expect(fks[0].label).to.equal("FK_Orders_Customers");
        expect(fks[0].description).to.contain("dbo.Customers");
        expect(fks[0].description).to.contain("CustomerId→CustomerId");

        const customers = (await h.controller.children(folders[0])).find(
            (n) => n.label === "dbo.Customers",
        )!;
        const customerKeys = await h.controller.children(
            (await h.controller.children(customers))[1],
        );
        expect(customerKeys.map((n) => `${n.label}:${n.icon}`)).to.deep.equal([
            "PK_Customers:Key_PrimaryKey",
            "UQ_Customers_Name:Key_UniqueKey",
        ]);

        const procs = await h.controller.children(folders[2]);
        const getOrders = procs.find((n) => n.label === "dbo.GetOrders")!;
        const [paramsFolder] = await h.controller.children(getOrders);
        const params = await h.controller.children(paramsFolder);
        expect(params.map((n) => n.label)).to.deep.equal(["@CustomerId", "@Total"]);
        expect(params[1].description).to.contain("output");
        expect(params[1].icon).to.equal("StoredProcedureParameter_Output");
        h.controller.dispose();
    });

    test("multi-database isolation: AppDb and OtherDb tables never mix", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const databases = await h.controller.children(dbFolder);
        const appDb = databases.find((n) => n.label === "AppDb")!;
        const otherDb = databases.find((n) => n.label === "OtherDb")!;
        const [appFolders, otherFolders] = [
            await h.controller.children(appDb),
            await h.controller.children(otherDb),
        ];
        await h.controller.refreshNode(appDb);
        await h.controller.refreshNode(otherDb);
        const appTables = (await h.controller.children(appFolders[0])).map((n) => n.label);
        const otherTables = (await h.controller.children(otherFolders[0])).map((n) => n.label);
        expect(appTables).to.contain("dbo.Orders");
        expect(appTables).to.not.contain("dbo.Widgets");
        expect(otherTables).to.contain("dbo.Widgets");
        expect(otherTables).to.not.contain("dbo.Orders");
        h.controller.dispose();
    });

    test("stale object path recovers as an explicit error, not a ghost", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        const folders = await h.controller.children(appDb);
        await h.controller.refreshNode(appDb);
        const tables = await h.controller.children(folders[0]);
        const children = await h.controller.children({
            ...tables[0],
            path: {
                kind: "objectFolder",
                connectionId: "p1",
                database: "AppDb",
                schema: "dbo",
                name: "Dropped",
                objectKind: "table",
                folder: "columns",
            },
        } as OeV2Node);
        expect(children).to.have.length(1);
        expect(children[0].kind).to.equal("error");
        expect(children[0].label).to.contain("not found");
        h.controller.dispose();
    });

    test("disconnect releases leases and returns the tree to the connect hint", async () => {
        const h = harness();
        const { server, dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        await h.controller.children(appDb);
        await h.controller.refreshNode(appDb);
        expect(h.store.status().databases.length).to.be.greaterThan(0);

        await h.controller.disconnectProfile("p1");
        expect(h.registry.stateOf("p1")).to.equal("disconnected");
        // leases released → zero-ref (warm within TTL is fine; not leaked refs)
        for (const entry of h.store.status().databases) {
            expect(entry.refCount).to.equal(0);
        }
        const hint = await h.controller.children(server);
        expect(hint[0].kind).to.equal("status");
        expect(hint[0].label).to.contain("Connect");
        h.controller.dispose();
    });
});
