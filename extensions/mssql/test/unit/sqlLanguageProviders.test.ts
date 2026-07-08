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
import { QueryStudioLanguageService } from "../../src/queryStudio/queryStudioLanguageService";

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

suite("sqlLanguage shadow connection lifecycle (LS-0 gate)", () => {
    test("native-only traffic never creates the shadow connection", async () => {
        const service = new QueryStudioLanguageService({
            backingDocument: () => undefined,
            sessionBinding: () => undefined,
            databases: () => undefined,
        });
        try {
            // folding + documentSymbols are native-routed under the default
            // sqlToolsService preference; neither may touch the shadow path.
            await service.folding();
            await service.documentSymbols();
            expect(service.status().shadowConnectionState).to.equal("none");
        } finally {
            service.dispose();
        }
    });

    test("bridge-routed request without a profile stays honestly disconnected", async () => {
        const service = new QueryStudioLanguageService({
            backingDocument: () => undefined,
            sessionBinding: () => undefined,
            databases: () => undefined,
        });
        try {
            const result = await service.completion({ line: 0, character: 0 }, "invoke");
            // No backing document and no profile: unserved, no shadow state.
            expect(result).to.equal(undefined);
            expect(service.status().shadowConnectionState).to.equal("none");
        } finally {
            service.dispose();
        }
    });
});
