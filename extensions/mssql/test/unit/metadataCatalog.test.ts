/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Metadata catalog service (B5): hydration over a scripted data plane
 * (H1–H3 + FK), SoA snapshot reads (resolveName exact/defaultSchema/
 * ambiguous + case-sensitive policy, prefix search, columns), deterministic
 * schema-context projection (byte-identical, budget degradation, privacy
 * gate, FK one-hop), DDL sniff → refresh, and honest section failure
 * (columns failed ⇒ partial, never empty-ready).
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { CatalogBuilder } from "../../src/services/metadata/catalogModel";
import {
    DataPlaneMetadataSessionSource,
    MetadataService,
    typeDisplay,
} from "../../src/services/metadata/metadataService";
import { CatalogLanguageMetadataProvider } from "../../src/sqlLanguage/provider/catalogProvider";

function sysScripts(overrides?: { columnsFail?: boolean }): FakeScript[] {
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
            // H4 + H5B contain "sys.columns" too — they must match before H3.
            match: (t) => t.includes("is_primary_key"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "name"],
                    rows: [
                        [101, "OrderId"],
                        [102, "CustomerId"],
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
                        [101, 1, "Orders", "U", "2026-01-01T00:00:00"],
                        [102, 1, "Customers", "U", "2026-01-01T00:00:00"],
                        [103, 1, "OrdersView", "V", "2026-01-01T00:00:00"],
                        [104, 2, "Orders", "U", "2026-01-01T00:00:00"],
                        [105, 1, "GetOrders", "P", "2026-01-01T00:00:00"],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        overrides?.columnsFail
            ? {
                  match: (t) => t.includes("sys.columns"),
                  events: [
                      { type: "message", kind: "error", text: "permission denied" },
                      { type: "complete", status: "failed" },
                  ],
              }
            : {
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
                          // Bit columns arrive as boolean OR 0/1 depending on
                          // the wire; both forms appear here on purpose.
                          rows: [
                              [101, 1, "OrderId", "int", 4, 10, 0, false, true, false],
                              [101, 2, "CustomerId", "int", 4, 10, 0, true, false, false],
                              [101, 3, "Total", "decimal", 9, 18, 2, true, 0, 1],
                              [102, 1, "CustomerId", "int", 4, 10, 0, false, 1, 0],
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
    ];
}

async function serviceOver(scripts: FakeScript[]) {
    const backend = new FakeBackend({ scripts });
    const source = new DataPlaneMetadataSessionSource(backend, {
        profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
        applicationName: "test",
    });
    const service = new MetadataService(source, { pollSeconds: 0 });
    return { service, source };
}

const KEY = { serverFingerprint: "sha256:test", database: "Db1" };

suite("Metadata catalog (B5)", () => {
    test("typeDisplay renders SQL type shapes", () => {
        expect(typeDisplay("nvarchar", 200, 0, 0)).to.equal("nvarchar(100)");
        expect(typeDisplay("nvarchar", -1, 0, 0)).to.equal("nvarchar(max)");
        expect(typeDisplay("decimal", 9, 18, 2)).to.equal("decimal(18,2)");
        expect(typeDisplay("int", 4, 10, 0)).to.equal("int");
        expect(typeDisplay("datetime2", 8, 27, 7)).to.equal("datetime2(7)");
    });

    test("hydration: schemas/objects/columns/FKs land; snapshot reads serve", async () => {
        const { service } = await serviceOver(sysScripts());
        const statuses: string[] = [];
        const handle = service.acquire(KEY, (s) => statuses.push(s.readiness));
        await handle.refresh();
        const snapshot = handle.current()!;
        expect(handle.status().readiness).to.equal("ready");
        expect(snapshot.stats).to.deep.include({ schemas: 2, objects: 5, columns: 5 });
        expect(snapshot.listSchemas().map((s) => s.name)).to.deep.equal(["dbo", "sales"]);
        expect(snapshot.getObject(101)!.schema).to.equal("dbo");
        expect(snapshot.getColumns(101).map((c) => `${c.name}:${c.typeDisplay}`)).to.deep.equal([
            "OrderId:int",
            "CustomerId:int",
            "Total:decimal(18,2)",
        ]);
        expect(snapshot.getForeignKeysFrom(101)[0].toObjectId).to.equal(102);
        expect(statuses[0]).to.equal("loading");
        handle.dispose();
        service.dispose();
    });

    test("hydration richness (B6): env facts, PK columns, FK column pairs, parameters", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const snapshot = handle.current()!;
        expect(handle.status().mode).to.equal("full");
        expect(snapshot.engineEdition).to.equal(5);
        expect(snapshot.defaultSchema).to.equal("dbo");
        expect(snapshot.caseSensitive).to.equal(false);
        expect(snapshot.getPrimaryKeyColumns(101)).to.deep.equal(["OrderId"]);
        const fkDetails = snapshot.getForeignKeyDetailsFrom(101);
        expect(fkDetails).to.have.length(1);
        expect(fkDetails[0].columns).to.deep.equal([
            { fromColumn: "CustomerId", toColumn: "CustomerId" },
        ]);
        expect(
            snapshot.getParameters(105).map((p) => `${p.name}:${p.typeDisplay}:${p.isOutput}`),
        ).to.deep.equal(["@CustomerId:int:false", "@Total:decimal(18,2):true"]);
        handle.dispose();
        service.dispose();
    });

    test("H3 identity/computed flags reach snapshot columns and the pinned language view", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const snapshot = handle.current()!;

        // Snapshot surface: flags set only when true (absent = unknown/false),
        // parsed from both boolean and 0/1 bit wire forms.
        const orders = snapshot.getColumns(101);
        expect(orders[0]).to.deep.equal({
            ordinal: 0,
            name: "OrderId",
            typeDisplay: "int",
            nullable: false,
            isIdentity: true,
        });
        expect(orders[1]).to.not.have.property("isIdentity");
        expect(orders[1]).to.not.have.property("isComputed");
        expect(orders[2].isComputed).to.equal(true); // 0/1 wire form
        expect(orders[2].isIdentity).to.equal(undefined);
        expect(snapshot.getColumns(102)[0].isIdentity).to.equal(true); // 1/0 wire form

        // Language provider surface: pinned view maps the flags onto LangColumn.
        const provider = new CatalogLanguageMetadataProvider({
            handle: () => handle,
            serverVersion: () => "16.0.4165.4",
            currentDatabase: () => KEY.database,
            databases: () => [KEY.database],
            subscribeStatus: () => () => undefined,
        });
        const pinned = provider.pin();
        const columns = pinned.getColumns({ objectId: 101 })!;
        expect(
            columns.map((c) => `${c.name}:${c.isIdentity ?? "-"}:${c.isComputed ?? "-"}`),
        ).to.deep.equal(["OrderId:true:-", "CustomerId:-:-", "Total:-:true"]);
        expect(columns[0].isPrimaryKey).to.equal(true);
        handle.dispose();
        service.dispose();
    });

    test("resolveName: exact, defaultSchema preference, ambiguity policy, prefix search", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const snapshot = handle.current()!;
        expect(snapshot.resolveName(["sales", "Orders"])).to.deep.include({
            kind: "resolved",
            objectId: 104,
        });
        expect(snapshot.resolveName(["orders"])).to.deep.include({
            kind: "resolved",
            objectId: 101,
            confidence: "defaultSchema",
        });
        expect(snapshot.resolveName(["Missing"]).kind).to.equal("notFound");
        expect(snapshot.search("or").map((o) => `${o.schema}.${o.name}`)).to.deep.equal([
            "dbo.Orders",
            "sales.Orders",
            "dbo.OrdersView",
        ]);
        handle.dispose();
        service.dispose();
    });

    test("case-sensitive catalogs: folded-only match never resolves silently", () => {
        const builder = new CatalogBuilder();
        builder.caseSensitive = true;
        builder.addSchema(1, "dbo");
        builder.addObject(1, 1, "Orders", "table");
        builder.addObject(2, 1, "ORDERS", "table");
        const snapshot = builder.build(1, { schemas: "ready", objects: "ready" });
        // Exact raw match resolves (dbo.Orders and dbo.ORDERS are distinct
        // CS objects); the folded-only lookup is the ambiguous one.
        expect(snapshot.resolveName(["Orders"]).kind).to.equal("resolved");
        expect(snapshot.resolveName(["oRdErS"]).kind).to.equal("ambiguous");
        const builder2 = new CatalogBuilder();
        builder2.caseSensitive = true;
        builder2.addSchema(1, "dbo");
        builder2.addObject(1, 1, "Orders", "table");
        const snap2 = builder2.build(1, { schemas: "ready", objects: "ready" });
        expect(snap2.resolveName(["Orders"]).kind).to.equal("resolved");
        expect(snap2.resolveName(["orders"]).kind).to.equal("notFound");
    });

    test("schema context: byte-identical; budgets degrade fidelity deterministically", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const request = {
            budget: "balanced" as const,
            privacy: { destination: "local" as const, allowObjectNames: true },
        };
        const a = handle.buildSchemaContext(request);
        expect(a.text).to.equal(handle.buildSchemaContext(request).text);
        expect(a.text).to.include("dbo.Orders (table): OrderId int");
        expect(a.truncated).to.equal(false);
        const tight = handle.buildSchemaContext({ ...request, budget: { maxChars: 60 } });
        expect(tight.charCount).to.be.at.most(60);
        expect(tight.truncated).to.equal(true);
        handle.dispose();
        service.dispose();
    });

    test("schema context: focus + FK one-hop pulls the referenced table in", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const result = handle.buildSchemaContext({
            budget: "balanced",
            focus: { nameHints: ["dbo.Orders"] },
            privacy: { destination: "local", allowObjectNames: true },
        });
        expect(result.text).to.include("dbo.Orders");
        expect(result.text).to.include("dbo.Customers");
        expect(result.text).to.not.include("sales.Orders");
        handle.dispose();
        service.dispose();
    });

    test("privacy gate: remoteLm without allowObjectNames degrades to empty", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const result = handle.buildSchemaContext({
            budget: "unlimited",
            privacy: { destination: "remoteLm", allowObjectNames: false },
        });
        expect(result.degraded).to.equal("privacyPolicy");
        expect(result.text).to.equal("");
        handle.dispose();
        service.dispose();
    });

    test("DDL sniff: successful CREATE re-hydrates (generation bump); non-DDL/failed do not", async () => {
        const { service } = await serviceOver(sysScripts());
        const handle = service.acquire(KEY);
        await handle.refresh();
        const before = handle.status().generation;
        handle.notifyExecutedBatch({ text: "CREATE TABLE t(i int)", succeeded: true });
        await new Promise((r) => setTimeout(r, 25));
        expect(handle.status().generation).to.be.greaterThan(before);
        const gen = handle.status().generation;
        handle.notifyExecutedBatch({ text: "select 1", succeeded: true });
        handle.notifyExecutedBatch({ text: "DROP TABLE t", succeeded: false });
        await new Promise((r) => setTimeout(r, 25));
        expect(handle.status().generation).to.equal(gen);
        handle.dispose();
        service.dispose();
    });

    test("section failure honesty: columns fail ⇒ 'failed' + partial, objects still ready", async () => {
        const { service } = await serviceOver(sysScripts({ columnsFail: true }));
        const handle = service.acquire(KEY);
        await handle.refresh();
        const snapshot = handle.current()!;
        expect(handle.status().readiness).to.equal("ready");
        expect(handle.status().mode).to.equal("partial");
        expect(snapshot.readiness.columns).to.equal("failed");
        expect(snapshot.readiness.objects).to.equal("ready");
        expect(snapshot.getColumns(101)).to.deep.equal([]);
        handle.dispose();
        service.dispose();
    });

    test("dedicated session source reuses an open session and reopens after loss", async () => {
        const backend = new FakeBackend({ scripts: sysScripts() });
        const source = new DataPlaneMetadataSessionSource(backend, {
            profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
            applicationName: "test",
        });
        const first = await source.open();
        expect(await source.open()).to.equal(first);
        await first.close();
        const second = await source.open();
        expect(second).to.not.equal(first);
        source.dispose();
    });
});
