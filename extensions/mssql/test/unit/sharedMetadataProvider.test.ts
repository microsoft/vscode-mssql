/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    unknownEngineCapabilities,
} from "@vscode-mssql/tsql-language-service";
import { SharedMetadataProvider } from "../../src/languageservice/preview/sharedMetadataProvider";
import { CatalogBuilder, type CatalogSnapshot } from "../../src/services/metadata/catalogModel";
import type {
    DatabaseCatalogLease,
    ServerCatalogLease,
} from "../../src/services/metadata/metadataStore";
import type { AuxCatalogItem } from "../../src/services/metadata/auxiliaryCatalog";

suite("SharedMetadataProvider", () => {
    test("projects current and lazily acquired cross-database catalogs", async () => {
        const current = catalog("SalesDb", 7, 10, "Orders");
        const archive = catalog("ArchiveDb", 3, 20, "OrderHistory");
        const acquiredDatabases: string[] = [];
        const server = serverLease(["SalesDb", "ArchiveDb"]);
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(server),
            acquireDatabase: (database) => {
                acquiredDatabases.push(database);
                return Promise.resolve(
                    database.toLowerCase() === "archivedb"
                        ? databaseLease("ArchiveDb", archive)
                        : databaseLease("SalesDb", current),
                );
            },
            environment: {
                database: "SalesDb",
                serverVersion: "16.0.1000",
                engineEdition: 3,
            },
        });

        await provider.waitForHydration();
        let view = provider.pin();
        expect(view.databases()).to.deep.equal([{ name: "SalesDb" }, { name: "ArchiveDb" }]);
        expect(view.resolveObject(["dbo", "Orders"]).kind).to.equal("resolved");
        expect(view.databaseCatalogCompleteness("ArchiveDb")).to.deep.equal({
            schemas: "unknown",
            objects: "unknown",
        });

        provider.requestHydration({
            section: "objects",
            database: "ArchiveDb",
            priority: "interactive",
            reason: "completion",
        });
        await provider.waitForHydration();
        view = provider.pin();

        const resolution = view.resolveObject(["ArchiveDb", "dbo", "OrderHistory"]);
        expect(resolution.kind).to.equal("resolved");
        expect(acquiredDatabases).to.deep.equal(["SalesDb", "ArchiveDb"]);
        expect(
            view.searchObjects({ database: "ArchiveDb" }).map((object) => object.name),
        ).to.deep.equal(["OrderHistory"]);
        provider.dispose();
    });

    test("publishes cross-database identity without waiting for full catalog hydration", async () => {
        const archiveRefresh = sinon.stub().resolves();
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb", "ArchiveDb"])),
            acquireDatabase: (database) =>
                Promise.resolve(
                    database === "ArchiveDb"
                        ? identityOnlyDatabaseLease("ArchiveDb", archiveRefresh, [
                              {
                                  name: "history",
                                  kind: "schema",
                                  isSystem: false,
                                  objectId: 5,
                                  attributes: { entry: "schema" },
                              },
                              {
                                  name: "OrderHistory",
                                  schema: "history",
                                  kind: "table",
                                  isSystem: false,
                                  objectId: 20,
                                  attributes: { entry: "object", objectType: "U" },
                              },
                          ])
                        : databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders")),
                ),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();

        provider.requestHydration({
            section: "objects",
            database: "ArchiveDb",
            priority: "interactive",
            reason: "completion",
        });
        await provider.waitForHydration();

        expect(
            provider.pin().resolveObject(["ArchiveDb", "history", "OrderHistory"]).kind,
        ).to.equal("resolved");
        expect(provider.pin().schemas("ArchiveDb")).to.deep.equal([
            { database: "ArchiveDb", name: "history" },
        ]);
        expect(archiveRefresh.called).to.be.false;
        provider.dispose();
    });

    test("coalesces cross-database identity requests while acquisition is loading", async () => {
        let releaseIdentity!: () => void;
        let reportIdentityStarted!: () => void;
        const identityGate = new Promise<void>((resolve) => (releaseIdentity = resolve));
        const identityStarted = new Promise<void>((resolve) => (reportIdentityStarted = resolve));
        const archiveRefresh = sinon.stub().resolves();
        const archive = identityOnlyDatabaseLease("ArchiveDb", archiveRefresh, [
            {
                name: "history",
                kind: "schema",
                isSystem: false,
                objectId: 5,
                attributes: { entry: "schema" },
            },
        ]);
        const ensureIdentity = archive.auxiliary.ensureSection.bind(archive.auxiliary);
        sinon.stub(archive.auxiliary, "ensureSection").callsFake(async (key) => {
            if (key === "language/identity") {
                reportIdentityStarted();
                await identityGate;
            }
            await ensureIdentity(key);
        });
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb", "ArchiveDb"])),
            acquireDatabase: (database) =>
                Promise.resolve(
                    database === "ArchiveDb"
                        ? archive
                        : databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders")),
                ),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();

        provider.requestHydration({
            section: "schemas",
            database: "ArchiveDb",
            priority: "interactive",
            reason: "completion",
        });
        await identityStarted;
        provider.requestHydration({
            section: "objects",
            database: "ArchiveDb",
            priority: "interactive",
            reason: "completion",
        });
        releaseIdentity();
        await provider.waitForHydration();

        expect(archiveRefresh.called).to.be.false;
        expect(
            provider
                .catalogStats()
                .fetches.filter(
                    (fetch) =>
                        fetch.trigger === "completion" &&
                        (fetch.section === "schemas" || fetch.section === "objects"),
                ),
        ).to.have.length(1);
        provider.dispose();
    });

    test("publishes a newly selected current database before full hydration finishes", async () => {
        const refresh = sinon.stub().resolves();
        const server = serverLease(["ArchiveDb"]);
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(server),
            acquireDatabase: () =>
                Promise.resolve(
                    identityOnlyDatabaseLease("ArchiveDb", refresh, [
                        {
                            name: "history",
                            kind: "schema",
                            isSystem: false,
                            objectId: 5,
                            attributes: { entry: "schema" },
                        },
                        {
                            name: "OrderHistory",
                            schema: "history",
                            kind: "table",
                            isSystem: false,
                            objectId: 20,
                            attributes: { entry: "object", objectType: "U" },
                        },
                    ]),
                ),
            environment: { database: "ArchiveDb" },
        });

        await provider.waitForHydration();

        expect(provider.pin().resolveObject(["history", "OrderHistory"]).kind).to.equal("resolved");
        expect(refresh.called).to.be.false;
        expect((server.refresh as sinon.SinonStub).called).to.be.false;
        expect(provider.catalogStats().observedFetches).to.be.at.least(3);
        provider.dispose();
    });

    test("indexes a pinned catalog once across repeated binder lookups", async () => {
        const snapshot = catalog("SalesDb", 7, 10, "Orders");
        const listObjects = sinon.spy(snapshot, "listObjects");
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb"])),
            acquireDatabase: () => Promise.resolve(databaseLease("SalesDb", snapshot)),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();
        const view = provider.pin();
        const setupCalls = listObjects.callCount;

        for (let index = 0; index < 20; index++) {
            const resolution = view.resolveObject(["dbo", "Orders"]);
            expect(resolution.kind).to.equal("resolved");
            if (resolution.kind === "resolved") {
                expect(view.object(resolution.object.ref)?.name).to.equal("Orders");
                expect(view.columnState(resolution.object.ref).kind).to.equal("loaded");
            }
        }

        expect(listObjects.callCount - setupCalls).to.equal(1);
        provider.dispose();
    });

    test("refreshes the shared core catalog once for all language sections", async () => {
        const lease = databaseLease("SalesDb", catalog("SalesDb", 7, 10, "Orders"));
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb"])),
            acquireDatabase: () => Promise.resolve(lease),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();

        await provider.refresh();

        expect((lease.refresh as sinon.SinonStub).calledOnce).to.be.true;
        provider.dispose();
    });

    test("publishes shared refreshes and resident hits to dashboard catalog statistics", async () => {
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb"])),
            acquireDatabase: () =>
                Promise.resolve(databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders"))),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();

        const resolution = provider.pin().resolveObject(["dbo", "Orders"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind !== "resolved") throw new Error("Expected resolved object");
        provider.noteResidentUse({
            section: "columns",
            object: resolution.object.ref,
            priority: "interactive",
            reason: "completion",
        });

        const stats = provider.catalogStats();
        expect(stats.observedFetches).to.be.at.least(3);
        expect(stats.fetches.map((fetch) => fetch.section)).to.include.members([
            "databases",
            "objects",
            "columns",
        ]);
        expect(stats.fetches.find((fetch) => fetch.section === "columns")?.source).to.equal(
            "resident",
        );
        expect(stats.scopes).to.have.length(2);
        provider.dispose();
    });

    test("powers SELECT star and INSERT expansion from shared columns", async () => {
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb"])),
            acquireDatabase: () =>
                Promise.resolve(databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders"))),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, unknownEngineCapabilities),
            new CatalogSemanticBinder(),
            provider,
        );
        const features = new TsqlLanguageFeatureService(runtime, provider);

        const selectSql = "SELECT * FROM dbo.Orders;";
        await runtime.open("file:///shared-select.sql", 1, selectSql);
        const selectExpansion = features
            .completion("file:///shared-select.sql", 1, selectSql.indexOf("*") + 1)
            .items.find((item) => item.label === "Expand SELECT *");
        expect(selectExpansion?.edit?.newText).to.equal("[Id], [Display Name]");

        const insertSql = "INSERT INTO dbo.Orders";
        await runtime.open("file:///shared-insert.sql", 1, insertSql);
        const insertExpansion = features
            .completion("file:///shared-insert.sql", 1, insertSql.length)
            .items.find((item) => item.label === "Expand INSERT columns and VALUES");
        expect(insertExpansion?.edit?.newText).to.contain("[Display Name]");
        expect(insertExpansion?.edit?.newText).not.to.contain("[Id]");

        provider.dispose();
    });

    test("keeps unsupported sections honestly unavailable", async () => {
        const provider = new SharedMetadataProvider({
            acquireServer: () => Promise.resolve(serverLease(["SalesDb"])),
            acquireDatabase: () =>
                Promise.resolve(databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders"))),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();
        const view = provider.pin();
        const resolution = view.resolveObject(["dbo", "Orders"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind !== "resolved") throw new Error("Expected resolved object");

        expect(view.indexState(resolution.object.ref)).to.deep.equal({ kind: "notLoaded" });
        expect(view.triggerState(resolution.object.ref)).to.deep.equal({ kind: "notLoaded" });
        expect(view.completeness.principals).to.equal("unknown");
        expect(view.searchPrincipals({})).to.deep.equal([]);
        provider.dispose();
    });

    test("projects system objects and the richer shared catalog sections", async () => {
        const databaseValues: Readonly<Record<string, readonly AuxCatalogItem[]>> = {
            systemObjects: [
                {
                    name: "all_objects",
                    schema: "sys",
                    kind: "view",
                    isSystem: true,
                    objectId: -10,
                    attributes: { schemaBound: true, checkOption: false },
                },
            ],
            "language/systemColumns": [
                {
                    name: "object_id",
                    isSystem: true,
                    objectId: -10,
                    attributes: {
                        typeName: "int",
                        maxLength: 4,
                        precision: 10,
                        scale: 0,
                        nullable: false,
                        hidden: false,
                    },
                },
            ],
            "language/indexes": [
                {
                    name: "PK_Orders",
                    isSystem: false,
                    objectId: 10,
                    facts: { indexId: 1, sqlType: 1, keyOrdinal: 1 },
                    attributes: {
                        unique: true,
                        clustered: true,
                        statistics: false,
                        columnName: "Id",
                    },
                },
            ],
            "language/triggers": [
                {
                    name: "trg_Orders",
                    isSystem: false,
                    objectId: 10,
                    attributes: { insert: true, disabled: false },
                },
            ],
            "language/userTypes": [
                {
                    name: "Point",
                    schema: "dbo",
                    kind: "type",
                    isSystem: false,
                    objectId: 500,
                    attributes: {
                        typeCategory: "clr",
                        assemblyName: "SpatialTypes",
                        className: "Example.Point",
                    },
                },
            ],
            "language/objectFacts": [],
            "language/principals": [{ name: "app_user", kind: "S", isSystem: false, objectId: 5 }],
            "language/securables": [
                { name: "AppCertificate", kind: "certificate", isSystem: false, objectId: 7 },
            ],
            "language/collations": [{ name: "Latin1_General_100_CI_AS", isSystem: true }],
        };
        const databaseReady = Object.keys(databaseValues);
        const provider = new SharedMetadataProvider({
            acquireServer: () =>
                Promise.resolve(
                    serverLease(["SalesDb"], {
                        ready: ["language/principals", "language/securables"],
                        values: {
                            "language/principals": [
                                { name: "sa", kind: "S", isSystem: true, objectId: 1 },
                            ],
                            "language/securables": [
                                {
                                    name: "BackupCredential",
                                    kind: "credential",
                                    isSystem: false,
                                    objectId: 2,
                                },
                            ],
                        },
                    }),
                ),
            acquireDatabase: () =>
                Promise.resolve(
                    databaseLease("SalesDb", catalog("SalesDb", 1, 10, "Orders"), {
                        ready: databaseReady,
                        values: databaseValues,
                    }),
                ),
            environment: { database: "SalesDb" },
        });
        await provider.waitForHydration();
        const view = provider.pin();

        const system = view.resolveObject(["sys", "all_objects"]);
        expect(system.kind).to.equal("resolved");
        if (system.kind !== "resolved") throw new Error("Expected system object");
        expect(system.object.system).to.be.true;
        expect(view.columnState(system.object.ref)).to.deep.equal({
            kind: "loaded",
            value: [
                {
                    name: "object_id",
                    typeDisplay: "int",
                    nullable: false,
                    identity: undefined,
                    computed: undefined,
                    hidden: undefined,
                },
            ],
        });

        const orders = view.resolveObject(["dbo", "Orders"]);
        expect(orders.kind).to.equal("resolved");
        if (orders.kind !== "resolved") throw new Error("Expected Orders");
        expect(view.indexState(orders.object.ref).kind).to.equal("loaded");
        expect(view.triggerState(orders.object.ref)).to.deep.equal({
            kind: "loaded",
            value: [
                {
                    name: "trg_Orders",
                    insteadOf: undefined,
                    disabled: undefined,
                    insert: true,
                    update: undefined,
                    delete: undefined,
                },
            ],
        });

        const point = view.resolveObject(["dbo", "Point"]);
        expect(point.kind).to.equal("resolved");
        if (point.kind !== "resolved") throw new Error("Expected Point type");
        expect(view.clrTypeState(point.object.ref)).to.deep.equal({
            kind: "loaded",
            value: {
                className: "Example.Point",
                assemblyName: "SpatialTypes",
                members: [],
            },
        });
        expect(
            view.searchPrincipals({ database: "SalesDb" }).map((item) => item.name),
        ).to.have.members(["app_user", "sa"]);
        expect(view.searchSecurables({}).map((item) => item.name)).to.deep.equal([
            "BackupCredential",
        ]);
        expect(
            view.searchSecurables({ database: "SalesDb" }).map((item) => item.name),
        ).to.deep.equal(["AppCertificate"]);
        expect(view.collations()).to.deep.equal(["Latin1_General_100_CI_AS"]);

        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, unknownEngineCapabilities),
            new CatalogSemanticBinder(),
            provider,
        );
        const features = new TsqlLanguageFeatureService(runtime, provider);
        const systemSql = "SELECT * FROM sys.all_objects;";
        await runtime.open("file:///shared-system.sql", 1, systemSql);
        expect(
            features
                .completion("file:///shared-system.sql", 1, systemSql.indexOf("*") + 1)
                .items.find((item) => item.label === "Expand SELECT *")?.edit?.newText,
        ).to.equal("[object_id]");
        provider.dispose();
    });
});

function catalog(
    _database: string,
    generation: number,
    objectId: number,
    objectName: string,
): CatalogSnapshot {
    const builder = new CatalogBuilder();
    builder.setEnvironment({ defaultSchema: "dbo", caseSensitive: false, engineEdition: 3 });
    builder.addSchema(1, "dbo");
    builder.addObject(objectId, 1, objectName, "table");
    builder.addColumn(objectId, "Id", "int", false, true);
    builder.addColumn(objectId, "Display Name", "nvarchar(100)", true);
    builder.markPrimaryKeyColumn(objectId, "Id");
    return builder.build(generation, {
        schemas: "ready",
        objects: "ready",
        columns: "ready",
        keys: "ready",
        parameters: "ready",
        foreignKeys: "ready",
        constraints: "ready",
        descriptions: "ready",
    });
}

function databaseLease(
    database: string,
    snapshot: CatalogSnapshot,
    auxiliary?: {
        ready?: readonly string[];
        values?: Readonly<Record<string, readonly AuxCatalogItem[]>>;
    },
): DatabaseCatalogLease {
    const refresh = sinon.stub().resolves();
    return {
        key: { serverFingerprint: "server", database },
        auxiliary: auxiliaryCatalog(
            auxiliary?.ready ?? [
                "systemObjects",
                "language/userTypes",
                "language/objectFacts",
                "language/hiddenColumns",
            ],
            auxiliary?.values ?? {},
        ),
        status: () => ({
            readiness: "ready" as const,
            generation: snapshot.generation,
            mode: "full" as const,
            stats: {
                schemas: snapshot.listSchemas().length,
                objects: snapshot.listObjects().length,
                columns: snapshot
                    .listObjects()
                    .reduce(
                        (count, object) => count + snapshot.getColumns(object.objectId).length,
                        0,
                    ),
                foreignKeys: 0,
            },
        }),
        current: () => snapshot,
        refresh,
        onDidChange: () => ({ dispose: sinon.stub() }),
        dispose: sinon.stub(),
    } as unknown as DatabaseCatalogLease;
}

function serverLease(
    databases: readonly string[],
    auxiliary?: {
        ready?: readonly string[];
        values?: Readonly<Record<string, readonly AuxCatalogItem[]>>;
    },
): ServerCatalogLease {
    const refresh = sinon.stub().resolves();
    return {
        key: { serverFingerprint: "server" },
        auxiliary: auxiliaryCatalog(auxiliary?.ready ?? [], auxiliary?.values ?? {}),
        status: () => ({
            readiness: "ready" as const,
            generation: 1,
            databaseCount: databases.length,
        }),
        pin: () => ({
            generation: 1,
            readiness: "ready" as const,
            listDatabases: () =>
                databases.map((name) => ({ name, accessState: "accessible" as const })),
            getDatabase: (name: string) =>
                databases.includes(name) ? { name, accessState: "accessible" as const } : undefined,
        }),
        refresh,
        onDidChange: () => ({ dispose: sinon.stub() }),
        dispose: sinon.stub(),
    } as unknown as ServerCatalogLease;
}

function identityOnlyDatabaseLease(
    database: string,
    refresh: sinon.SinonStub,
    identity: readonly AuxCatalogItem[],
): DatabaseCatalogLease {
    return {
        key: { serverFingerprint: "server", database },
        auxiliary: auxiliaryCatalog([], { "language/identity": identity }),
        status: () => ({
            readiness: "loading" as const,
            generation: 0,
            mode: "full" as const,
            stats: { schemas: 0, objects: 0, columns: 0, foreignKeys: 0 },
        }),
        current: () => undefined,
        refresh,
        onDidChange: () => ({ dispose: sinon.stub() }),
        dispose: sinon.stub(),
    } as unknown as DatabaseCatalogLease;
}

function auxiliaryCatalog(
    ready: readonly string[] = [],
    values: Readonly<Record<string, readonly AuxCatalogItem[]>> = {},
) {
    const states = new Map<string, "absent" | "ready">(ready.map((key) => [key, "ready" as const]));
    return {
        status: (key: string) => ({ readiness: states.get(key) ?? "absent", generation: 1 }),
        items: (key: string) => (states.get(key) === "ready" ? (values[key] ?? []) : undefined),
        ensureSection: async (key: string) => {
            states.set(key, "ready");
        },
        refreshSection: async (key: string) => {
            states.set(key, "ready");
        },
    };
}
