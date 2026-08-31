/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B8 / LS-0 provider + harness suite: fourslash parsing, the fixture
 * provider over the standard catalog, and the catalog adapter's honest
 * offline behavior. Provider-equivalence expectations (design 05 §17.5)
 * grow with each feature batch.
 */

import { expect } from "chai";
import { FourslashDocument, parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import {
    CatalogLanguageMetadataProvider,
    MetadataCatalogHandle,
} from "../../src/sqlLanguage/provider/catalogProvider";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { CatalogBuilder, CatalogSnapshot } from "../../src/services/metadata/catalogModel";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";

function providerForSnapshot(snapshot: CatalogSnapshot): CatalogLanguageMetadataProvider {
    const handle = {
        status: () => ({
            readiness: "ready",
            generation: snapshot.generation,
            mode: snapshot.mode,
        }),
        current: () => snapshot,
        refresh: () => Promise.resolve(),
        getModuleDefinition: () => Promise.resolve({ unavailableReason: "notLoaded" as const }),
    } as unknown as MetadataCatalogHandle;
    return new CatalogLanguageMetadataProvider({
        handle: () => handle,
        serverVersion: () => "16.0.1000.0",
        currentDatabase: () => "FixtureDb",
        databases: () => ["FixtureDb"],
        subscribeStatus: () => () => undefined,
    });
}

suite("sqlLanguage fourslash harness", () => {
    test("parses caret and named markers, strips them from text", () => {
        const fixture = parseFourslash("SELECT o./*caret*/ FROM Sales.Orders /*src*/AS o;");
        expect(fixture.text).to.equal("SELECT o. FROM Sales.Orders AS o;");
        expect(fixture.caret).to.equal("SELECT o.".length);
        expect(fixture.markers.get("src")).to.equal("SELECT o. FROM Sales.Orders ".length);
    });

    test("document analysis at the caret", () => {
        const doc = new FourslashDocument("SELECT 1\nGO\nSELECT o./*caret*/\nFROM Sales.Orders o");
        expect(doc.caretPosition).to.deep.equal({ line: 2, character: 9 });
        expect(doc.segments.batches).to.have.length(2);
        expect(doc.segments.batches[1].statements[0].leadingWord).to.equal("SELECT");
    });

    test("duplicate markers are rejected", () => {
        expect(() => parseFourslash("a/*caret*/b/*caret*/")).to.throw(/Duplicate/);
    });
});

suite("sqlLanguage fixture provider over the standard catalog", () => {
    const provider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);
    const pinned = provider.pin();

    test("resolves schema-qualified and default-schema names", () => {
        const qualified = pinned.resolveObject(["Sales", "Orders"]);
        expect(qualified.kind).to.equal("resolved");

        // Unqualified "Orders" exists in Sales AND dbo — default schema wins.
        const unqualified = pinned.resolveObject(["Orders"]);
        expect(unqualified.kind).to.equal("resolved");
        if (unqualified.kind === "resolved") {
            expect(pinned.getObject(unqualified.ref)?.schema).to.equal("dbo");
            expect(unqualified.confidence).to.equal("defaultSchema");
        }
    });

    test("columns carry PK flags; parameters carry output flags", () => {
        const orders = pinned.resolveObject(["Sales", "Orders"]);
        expect(orders.kind).to.equal("resolved");
        if (orders.kind === "resolved") {
            const columns = pinned.getColumns(orders.ref);
            expect(columns?.map((c) => c.name)).to.deep.equal([
                "OrderID",
                "CustomerID",
                "OrderDate",
                "Comments",
            ]);
            expect(columns?.[0].isPrimaryKey).to.equal(true);
        }
        const proc = pinned.resolveObject(["Sales", "GetOrders"]);
        if (proc.kind === "resolved") {
            const params = pinned.getParameters(proc.ref);
            expect(params?.find((p) => p.name === "@Total")?.isOutput).to.equal(true);
        }
    });

    test("FK edges flow both directions with ordered pairs", () => {
        const orders = pinned.resolveObject(["Sales", "Orders"]);
        if (orders.kind !== "resolved") {
            throw new Error("expected resolution");
        }
        const from = pinned.fkFrom(orders.ref);
        expect(from).to.have.length(1);
        expect(from[0].columns).to.deep.equal([
            { fromColumn: "CustomerID", toColumn: "CustomerID" },
        ]);
        const to = pinned.fkTo(orders.ref);
        expect(to).to.have.length(1);
        expect(to[0].name).to.equal("FK_OrderLines_Orders");
    });

    test("prefix search respects kind and schema filters", () => {
        const tables = pinned.searchObjects({ prefix: "Or", kinds: ["table"] });
        expect(tables.map((o) => `${o.schema}.${o.name}`)).to.include("Sales.Orders");
        expect(tables.every((o) => o.kind === "table")).to.equal(true);

        const salesOnly = pinned.searchObjects({ schema: "Sales" });
        expect(salesOnly.every((o) => o.schema === "Sales")).to.equal(true);
    });

    test("databases and schemas are listed", () => {
        expect(provider.databases()?.map((d) => d.name)).to.include("FixtureDb");
        expect(pinned.listSchemas().map((s) => s.name)).to.deep.equal(["Sales", "dbo"]);
    });
});

suite("sqlLanguage catalog adapter offline honesty", () => {
    test("no handle -> offline readiness, unavailable resolution, empty search", () => {
        const provider = new CatalogLanguageMetadataProvider({
            handle: () => undefined,
            serverVersion: () => undefined,
            currentDatabase: () => undefined,
            databases: () => undefined,
            subscribeStatus: () => () => undefined,
        });
        expect(provider.readiness().mode).to.equal("offline");
        expect(provider.generation).to.equal(0);
        const pinned = provider.pin();
        expect(pinned.resolveObject(["Sales", "Orders"]).kind).to.equal("unavailable");
        expect(pinned.searchObjects({ prefix: "O" })).to.have.length(0);
        expect(provider.databases()).to.equal(undefined);
    });

    test("server capability gating by version", () => {
        const make = (version: string | undefined) =>
            new CatalogLanguageMetadataProvider({
                handle: () => undefined,
                serverVersion: () => version,
                currentDatabase: () => undefined,
                databases: () => undefined,
                subscribeStatus: () => () => undefined,
            }).env().capabilities;
        expect(make("16.0.4165.4").createOrAlterProgrammability).to.equal(true);
        expect(make("13.0.5026.0").createOrAlterProgrammability).to.equal(true); // 2016 SP1+
        expect(make("13.0.1601.5").createOrAlterProgrammability).to.equal(false); // 2016 RTM
        expect(make("12.0.2000.8").dropIfExists).to.equal(false);
        expect(make(undefined).createOrAlterProgrammability).to.equal(false);
    });

    test("session engine edition fills env before metadata environment is ready", () => {
        const provider = new CatalogLanguageMetadataProvider({
            handle: () => undefined,
            serverVersion: () => undefined,
            engineEdition: () => 5,
            currentDatabase: () => undefined,
            databases: () => undefined,
            subscribeStatus: () => () => undefined,
        });

        expect(provider.env().engineEdition).to.equal(5);
    });

    test("real CatalogBuilder snapshot maps through provider and engine", async () => {
        const builder = new CatalogBuilder();
        builder.setEnvironment({ defaultSchema: "dbo", caseSensitive: false, engineEdition: 5 });
        builder.addSchema(1, "dbo");
        builder.addObject(101, 1, "Orders", "table");
        builder.addColumn(101, "OrderId", "int", false);
        builder.addColumn(101, "Name", "nvarchar(50)", true);
        builder.markPrimaryKeyColumn(101, "OrderId");
        builder.addKeyConstraintColumn(101, "PK_Orders", "primaryKey", "OrderId");
        const snapshot = builder.build(7, {
            schemas: "ready",
            objects: "ready",
            columns: "ready",
            keys: "ready",
            parameters: "ready",
            foreignKeys: "ready",
        });
        const provider = providerForSnapshot(snapshot);
        const pinned = provider.pin();
        const resolution = pinned.resolveObject(["dbo", "Orders"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind !== "resolved") {
            throw new Error("expected real snapshot resolution");
        }
        expect(
            pinned.getColumns(resolution.ref)?.find((column) => column.name === "OrderId"),
        ).to.deep.include({ isPrimaryKey: true });
        expect(pinned.getKeyConstraints?.(resolution.ref)?.[0].name).to.equal("PK_Orders");

        const engine = new NativeSqlLanguageEngine(provider);
        const text = "SELECT o. FROM dbo.Orders o";
        const position = new TextSnapshot(text, 1).positionAt("SELECT o.".length);
        const completion = await engine.completion({
            text,
            version: 1,
            position,
            trigger: "invoke",
        });
        expect(completion?.items.map((item) => item.label)).to.include.members(["OrderId", "Name"]);
        expect(
            (await engine.diagnostics({ text: "SELECT OrderId FROM dbo.Orders", version: 2 }))
                ?.diagnostics,
        ).to.deep.equal([]);
    });

    test("prefix filtering cannot hide a valid kind behind capped matches", () => {
        const builder = new CatalogBuilder();
        builder.setEnvironment({ defaultSchema: "dbo", caseSensitive: false });
        builder.addSchema(1, "dbo");
        for (let i = 0; i < 1_205; i++) {
            builder.addObject(1_000 + i, 1, `usp_${String(i).padStart(4, "0")}`, "procedure");
        }
        builder.addObject(9_999, 1, "usp_zzzz_view", "view");
        const provider = providerForSnapshot(
            builder.build(8, { schemas: "ready", objects: "ready", columns: "ready" }),
        );
        expect(
            provider
                .pin()
                .searchObjects({ prefix: "usp_", kinds: ["view"], limit: 10 })
                .map((object) => `${object.kind}:${object.schema}.${object.name}`),
        ).to.include("view:dbo.usp_zzzz_view");
    });

    test("unknown catalog case rule suppresses binder diagnostics", async () => {
        const builder = new CatalogBuilder();
        builder.addSchema(1, "dbo");
        builder.addObject(101, 1, "Orders", "table");
        builder.addColumn(101, "OrderId", "int", false);
        const provider = providerForSnapshot(
            builder.build(9, { schemas: "ready", objects: "ready", columns: "ready" }),
        );
        expect(provider.env().caseSensitivityKnown).to.equal(false);
        const result = await new NativeSqlLanguageEngine(provider).diagnostics({
            text: "SELECT orderid FROM dbo.orders",
            version: 1,
        });
        expect(result?.diagnostics).to.deep.equal([]);
        expect(result?.suppressed?.metadataNotValidated).to.be.at.least(1);
    });

    test("requestHydration kicks ONE refresh and de-dupes repeat misses", async () => {
        let refreshCalls = 0;
        let releaseRefresh: () => void = () => undefined;
        const refreshGate = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        const handle = {
            status: () => ({ readiness: "ready", generation: 7, mode: "full" }),
            current: () => undefined,
            refresh: () => {
                refreshCalls++;
                return refreshGate;
            },
        } as unknown as MetadataCatalogHandle;
        const provider = new CatalogLanguageMetadataProvider({
            handle: () => handle,
            serverVersion: () => undefined,
            currentDatabase: () => undefined,
            databases: () => undefined,
            subscribeStatus: () => () => undefined,
        });
        const request = {
            kind: "columns" as const,
            object: { objectId: 42 },
            priority: "interactiveFollowup" as const,
        };
        provider.requestHydration(request);
        provider.requestHydration(request); // in flight: de-duped
        expect(refreshCalls).to.equal(1);
        releaseRefresh();
        await refreshGate;
        await new Promise((resolve) => setTimeout(resolve, 0)); // finally clears in-flight
        provider.requestHydration(request); // same generation: still de-duped
        expect(refreshCalls).to.equal(1);
    });

    test("null provider serves the same surface with nothing to claim", () => {
        const provider = new NullLanguageMetadataProvider();
        const pinned = provider.pin();
        expect(pinned.resolveObject(["x"]).kind).to.equal("unavailable");
        expect(pinned.getColumns({ objectId: 1 })).to.equal(undefined);
        expect(provider.readiness().mode).to.equal("offline");
    });
});
