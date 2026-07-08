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

interface DbScriptOptions {
    /** DB_NAME() answer for the digest identity rider (H-5) — must match
     *  the acquired database name unless a rename is being simulated. */
    currentDb?: string;
    counters?: { digest: number; hydrate: number };
    digestFails?: () => boolean;
    digestDelayMs?: () => number | undefined;
}

/** Catalog fixture: Orders/Customers + GetOrders proc + PK/UQ/FK. */
function dbScripts(tableName: string, opts: DbScriptOptions = {}): FakeScript[] {
    return [
        {
            // H7 descriptions — empty is a SUCCEEDED section (a missing
            // script would fail the hydration query and flip mode to partial).
            match: (t) => t.includes("extended_properties"),
            events: [
                {
                    type: "resultSet",
                    columns: ["major_id", "minor_id", "column_name", "description"],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => {
                const hit = t.includes("SERVERPROPERTY");
                if (hit && opts.counters) {
                    opts.counters.hydrate++;
                }
                return hit;
            },
            events: [
                {
                    type: "resultSet",
                    columns: ["engine_edition", "default_schema", "collation_name"],
                    // Edition 3 (on-prem): serverless auto-pause reduction is
                    // engine-level behavior pinned in the poll-governance suite.
                    rows: [[3, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => {
                const hit = t.includes("CHECKSUM_AGG");
                if (hit && opts.counters) {
                    opts.counters.digest++;
                }
                return hit;
            },
            get events() {
                if (opts.digestFails?.()) {
                    return [
                        { type: "message", kind: "error", text: "digest failed" },
                        { type: "complete", status: "failed" },
                    ];
                }
                const delayMs = opts.digestDelayMs?.();
                return [
                    {
                        type: "resultSet",
                        columns: ["current_db", "object_count", "object_hash"],
                        rows: [[opts.currentDb ?? "AppDb", 4, 12345]],
                        ...(delayMs !== undefined ? { delayMs } : {}),
                    },
                    { type: "complete", status: "succeeded" },
                ];
            },
        } as unknown as FakeScript,
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

function serverCatalogScript(
    databases: (string | number | boolean | null)[][],
    counters?: { list: number },
): FakeScript {
    return {
        match: (t) => {
            const hit = t.includes("sys.databases");
            if (hit && counters) {
                counters.list++;
            }
            return hit;
        },
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
    /** CACHE-5 browse-freshness knobs (small TTLs make digests observable). */
    freshness?: { validationTtlMs?: number; timeoutMs?: number };
    serverCounters?: { list: number };
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
                overrides?.serverCounters,
            ),
        ],
    });
    const service = new RoutingService(
        overrides?.databases ?? {
            AppDb: new FakeBackend({ scripts: dbScripts("Orders", { currentDb: "AppDb" }) }),
            OtherDb: new FakeBackend({ scripts: dbScripts("Widgets", { currentDb: "OtherDb" }) }),
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
        coordinatorFactory: (prepared) =>
            new OeV2MetadataCoordinator(store, prepared, overrides?.freshness),
        settings: () => settings,
    });
    return { controller, registry, store, fallback, settings };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    test("expanding a disconnected saved profile opens it and renders server children", async () => {
        const h = harness();
        const roots = await h.controller.children();
        const server = roots.find((n) => n.connectionId === "p1")!;
        expect(server.kind).to.equal("disconnectedConnection");

        const children = await h.controller.children(server);
        expect(h.registry.stateOf("p1")).to.equal("connected");
        expect(children.map((n) => n.label)).to.deep.equal(["Databases"]);
        h.controller.dispose();
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

    test("folder filter narrows objects honestly; clear restores; search finds by prefix", async () => {
        const h = harness();
        const { dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        const folders = await h.controller.children(appDb);
        await h.controller.refreshNode(appDb);
        const tablesFolder = folders[0];

        h.controller.setFolderFilter(tablesFolder, "Cust");
        const filtered = await h.controller.children(tablesFolder);
        expect(filtered.map((n) => `${n.kind}:${n.label}`)).to.deep.equal([
            "object:dbo.Customers",
            "status:Filter: 'Cust' (1 of 2 shown)",
        ]);

        h.controller.setFolderFilter(tablesFolder, "zzz-nothing");
        const none = await h.controller.children(tablesFolder);
        expect(none).to.have.length(1);
        expect(none[0].kind).to.equal("status");
        expect(none[0].label).to.contain("No matches");

        h.controller.clearFolderFilter(tablesFolder);
        const restored = await h.controller.children(tablesFolder);
        expect(restored.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);

        const matches = await h.controller.searchObjects("p1", "AppDb", "Ord");
        expect(matches.map((m) => `${m.schema}.${m.name}`)).to.deep.equal([
            "dbo.Orders",
            "dbo.OrdersView",
        ]);
        h.controller.dispose();
    });
});

/**
 * CACHE-5 browse freshness (addendum §7.2, block-with-loading): expands run
 * requireValidated with the oeBrowse preset — the first expand beyond the
 * TTL validates (one digest), expands within it reuse the validated
 * generation with ZERO SQL, timeout/failure with a snapshot renders the
 * children PLUS a stale-notice status child (never silent-stale, never
 * empty), and explicit refresh bypasses the TTL via lease.refresh().
 */
suite("Object Explorer v2 browse freshness (CACHE-5)", () => {
    let sendRequest: sinon.SinonSpy;
    let connect: sinon.SinonSpy;

    setup(() => {
        sendRequest = sinon.spy(SqlToolsServiceClient.prototype, "sendRequest");
        connect = sinon.spy(ConnectionManager.prototype, "connect");
    });

    teardown(() => {
        // THE TRIPWIRE: freshness wiring must not summon STS v1 either.
        sinon.assert.notCalled(sendRequest);
        sinon.assert.notCalled(connect);
        sendRequest.restore();
        connect.restore();
    });

    async function expandToTables(
        h: Harness,
    ): Promise<{ appDb: OeV2Node; tablesFolder: OeV2Node }> {
        const { dbFolder } = await browseToDatabases(h);
        const appDb = (await h.controller.children(dbFolder)).find((n) => n.label === "AppDb")!;
        const folders = await h.controller.children(appDb);
        await h.controller.refreshNode(appDb); // awaits catalog hydration
        return { appDb, tablesFolder: folders[0] };
    }

    test("first expand beyond the TTL validates once; expands within it run ZERO digests", async () => {
        const counters = { digest: 0, hydrate: 0 };
        const h = harness({
            databases: {
                AppDb: new FakeBackend({
                    scripts: dbScripts("Orders", { currentDb: "AppDb", counters }),
                }),
                OtherDb: new FakeBackend({
                    scripts: dbScripts("Widgets", { currentDb: "OtherDb" }),
                }),
            },
            freshness: { validationTtlMs: 200 },
        });
        const { tablesFolder } = await expandToTables(h);

        // Within the TTL of the hydration: validated from memory, no SQL.
        const withinTtl = await h.controller.children(tablesFolder);
        expect(withinTtl.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        expect(counters.digest, "T0 memory tier — no digest").to.equal(0);

        await sleep(250); // step beyond the TTL
        const firstBeyondTtl = await h.controller.children(tablesFolder);
        expect(counters.digest, "first expand beyond the TTL runs ONE digest").to.equal(1);
        // Validated verdict renders clean children — no stale notice.
        expect(firstBeyondTtl.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);

        for (let i = 0; i < 10; i++) {
            const again = await h.controller.children(tablesFolder);
            expect(again.map((n) => n.label)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        }
        expect(counters.digest, "ten expands within the TTL — zero additional digests").to.equal(1);
        h.controller.dispose();
    });

    test("validation FAILURE with a snapshot renders children PLUS a stale notice — never silent, never empty", async () => {
        const counters = { digest: 0, hydrate: 0 };
        let digestFails = false;
        const h = harness({
            databases: {
                AppDb: new FakeBackend({
                    scripts: dbScripts("Orders", {
                        currentDb: "AppDb",
                        counters,
                        digestFails: () => digestFails,
                    }),
                }),
                OtherDb: new FakeBackend({
                    scripts: dbScripts("Widgets", { currentDb: "OtherDb" }),
                }),
            },
            freshness: { validationTtlMs: 40 },
        });
        const { tablesFolder } = await expandToTables(h);

        digestFails = true;
        await sleep(80); // beyond the TTL — the next expand must validate
        const stale = await h.controller.children(tablesFolder);
        expect(stale[0].kind, "stale notice leads the children").to.equal("status");
        expect(stale[0].label).to.contain("Metadata not validated");
        expect(stale[0].label).to.contain("refresh to retry");
        expect(
            stale.map((n) => n.label).slice(1),
            "the snapshot still renders — stale is NEVER silent emptiness",
        ).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        h.controller.dispose();
    });

    test("validation TIMEOUT with a snapshot renders children plus the notice (wait budget is a race)", async () => {
        const counters = { digest: 0, hydrate: 0 };
        let slowDigest = false;
        const h = harness({
            databases: {
                AppDb: new FakeBackend({
                    scripts: dbScripts("Orders", {
                        currentDb: "AppDb",
                        counters,
                        digestDelayMs: () => (slowDigest ? 300 : undefined),
                    }),
                }),
                OtherDb: new FakeBackend({
                    scripts: dbScripts("Widgets", { currentDb: "OtherDb" }),
                }),
            },
            freshness: { validationTtlMs: 40, timeoutMs: 40 },
        });
        const { tablesFolder } = await expandToTables(h);

        slowDigest = true;
        await sleep(80);
        const stale = await h.controller.children(tablesFolder);
        expect(stale[0].kind).to.equal("status");
        expect(stale[0].label).to.contain("Metadata not validated");
        expect(stale.map((n) => n.label).slice(1)).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        h.controller.dispose();
    });

    test("explicit refresh bypasses the TTL (lease.refresh, not a digest)", async () => {
        const counters = { digest: 0, hydrate: 0 };
        const h = harness({
            databases: {
                AppDb: new FakeBackend({
                    scripts: dbScripts("Orders", { currentDb: "AppDb", counters }),
                }),
                OtherDb: new FakeBackend({
                    scripts: dbScripts("Widgets", { currentDb: "OtherDb" }),
                }),
            },
            // Default oeBrowse TTL (120s): nothing here ever expires it.
        });
        const { appDb, tablesFolder } = await expandToTables(h);
        await h.controller.children(tablesFolder);
        const hydrationsBefore = counters.hydrate;

        await h.controller.refreshNode(appDb);
        expect(counters.hydrate, "explicit refresh re-hydrates despite the TTL").to.equal(
            hydrationsBefore + 1,
        );
        expect(counters.digest, "freshness never ran a digest inside the TTL").to.equal(0);
        h.controller.dispose();
    });

    test("server-catalog expands revalidate beyond the TTL (§4.4: validation ≡ re-hydration)", async () => {
        const serverCounters = { list: 0 };
        const h = harness({ serverCounters, freshness: { validationTtlMs: 200 } });
        const { dbFolder } = await browseToDatabases(h);
        const baseline = serverCounters.list;

        const withinTtl = await h.controller.children(dbFolder);
        expect(withinTtl.map((n) => n.label)).to.deep.equal([
            "AppDb",
            "Locked",
            "OtherDb",
            "master",
        ]);
        expect(serverCounters.list, "within the TTL: no re-hydration").to.equal(baseline);

        await sleep(250);
        const beyondTtl = await h.controller.children(dbFolder);
        expect(beyondTtl.map((n) => n.label)).to.deep.equal([
            "AppDb",
            "Locked",
            "OtherDb",
            "master",
        ]);
        expect(serverCounters.list, "beyond the TTL: one re-hydration").to.equal(baseline + 1);
        h.controller.dispose();
    });

    test("H-5 through the tree: a renamed database renders the access-changed notice and counts the drift", async () => {
        const counters = { digest: 0, hydrate: 0 };
        const h = harness({
            databases: {
                AppDb: new FakeBackend({
                    // DB_NAME() disagrees with the browsed database name —
                    // somebody renamed it underneath the warm lease.
                    scripts: dbScripts("Orders", { currentDb: "AppDb_Renamed", counters }),
                }),
                OtherDb: new FakeBackend({
                    scripts: dbScripts("Widgets", { currentDb: "OtherDb" }),
                }),
            },
            freshness: { validationTtlMs: 40 },
        });
        const { tablesFolder } = await expandToTables(h);

        await sleep(80); // beyond the TTL — the next expand runs the digest
        const drifted = await h.controller.children(tablesFolder);
        expect(drifted[0].kind).to.equal("status");
        expect(drifted[0].label).to.contain("database access may have changed");
        expect(
            drifted.map((n) => n.label).slice(1),
            "allowStale-equivalent render: last known catalog still shows",
        ).to.deep.equal(["dbo.Customers", "dbo.Orders"]);
        expect(h.store.status().keyCorrectnessViolations, "driftRename counted").to.equal(1);
        h.controller.dispose();
    });
});
