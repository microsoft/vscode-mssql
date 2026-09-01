/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-PRE determinism fixes (cache/drift review addendum):
 * - T-A1 (C-1): ordinal, locale-independent ordering everywhere that feeds
 *   buildSchemaContext bytes — pinned against a fixture with underscores,
 *   digits, mixed case, and non-ASCII (ICU collation would order these
 *   differently and drifts across Electron/platform).
 * - T-A2 (C-11): collation case-sensitivity truth table including binary
 *   collations, plus the resolveName behavior on a _BIN2 catalog.
 * - T-A3 (H-1): digest v2 detects an out-of-editor rename (name participates
 *   in the hash); the v1 recipe's documented blindness is pinned so the
 *   improvement cannot silently regress.
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    buildSchemaContext,
    CatalogBuilder,
    ordinalCompare,
} from "../../src/services/metadata/catalogModel";
import {
    collationIsCaseSensitive,
    DataPlaneMetadataSessionSource,
    MetadataService,
} from "../../src/services/metadata/metadataService";

const KEY = { serverFingerprint: "sha256:test", database: "Db1" };

function serviceOver(scripts: FakeScript[]): MetadataService {
    const backend = new FakeBackend({ scripts });
    const source = new DataPlaneMetadataSessionSource(backend, {
        profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
        applicationName: "test",
    });
    return new MetadataService(source, { pollSeconds: 0 });
}

// ---------------------------------------------------------------------------
// T-A1 — ordinal ordering (C-1)
// ---------------------------------------------------------------------------

suite("Metadata determinism: ordinal ordering (C-1)", () => {
    test("ordinalCompare: folded code-unit order with raw tiebreak", () => {
        // The canonical SQL-world case: ICU default collation gives the
        // underscore no primary weight, ordering OrderHeader before
        // Order_Details; ordinal comparison keeps '_' (0x5F) < 'h' (0x68).
        expect(ordinalCompare("Order_Details", "OrderHeader")).to.be.lessThan(0);
        expect(ordinalCompare("OrderHeader", "Order_Details")).to.be.greaterThan(0);
        // Digits compare by code unit: "Table10" < "Table2".
        expect(ordinalCompare("Table10", "Table2")).to.be.lessThan(0);
        // Case-insensitive primary order…
        expect(ordinalCompare("orders", "PRODUCTS")).to.be.lessThan(0);
        // …with a deterministic raw tiebreak for case-only differences.
        expect(ordinalCompare("Foo", "foo")).to.be.lessThan(0);
        expect(ordinalCompare("foo", "Foo")).to.be.greaterThan(0);
        expect(ordinalCompare("same", "same")).to.equal(0);
        // Non-ASCII sorts after ASCII by code unit ('ä' 0xE4 > 'z' 0x7A) —
        // stable everywhere, unlike ICU's language-sensitive placement.
        expect(ordinalCompare("Äpfel", "zeta")).to.be.greaterThan(0);
    });

    function mixedNameSnapshot() {
        const b = new CatalogBuilder();
        b.setEnvironment({ defaultSchema: "dbo", caseSensitive: false });
        b.addSchema(1, "dbo");
        b.addObject(201, 1, "OrderHeader", "table");
        b.addObject(202, 1, "Order_Details", "table");
        b.addObject(203, 1, "alpha", "table");
        b.addObject(204, 1, "Zeta", "table");
        b.addObject(205, 1, "Äpfel", "table");
        for (const id of [201, 202, 203, 204, 205]) {
            b.addColumn(id, "Id", "int", false);
        }
        return b.build(1, { schemas: "ready", objects: "ready", columns: "ready" }, "full");
    }

    test("listObjects orders by folded code units (underscore/digit/non-ASCII pinned)", () => {
        const names = mixedNameSnapshot()
            .listObjects()
            .map((o) => o.name);
        expect(names).to.deep.equal(["alpha", "Order_Details", "OrderHeader", "Zeta", "Äpfel"]);
    });

    test("schema-context bytes are pinned for the mixed-name fixture and repeat-stable", () => {
        const snapshot = mixedNameSnapshot();
        const request = {
            budget: "unlimited" as const,
            privacy: { destination: "local" as const, allowObjectNames: true },
        };
        const first = buildSchemaContext(snapshot, request);
        // Exact bytes: any comparator drift (ICU, platform, Electron bump)
        // fails this test — the guarantee persisted prompts rely on.
        expect(first.text).to.equal(
            [
                "dbo.alpha (table): Id int",
                "dbo.Order_Details (table): Id int",
                "dbo.OrderHeader (table): Id int",
                "dbo.Zeta (table): Id int",
                "dbo.Äpfel (table): Id int",
            ].join("\n"),
        );
        const second = buildSchemaContext(snapshot, request);
        expect(second.text).to.equal(first.text);
    });
});

// ---------------------------------------------------------------------------
// T-A2 — collation case sensitivity (C-11)
// ---------------------------------------------------------------------------

suite("Metadata determinism: collation case sensitivity (C-11)", () => {
    test("truth table: _CS and binary collations are case-sensitive", () => {
        expect(collationIsCaseSensitive("Latin1_General_CS_AS")).to.equal(true);
        expect(collationIsCaseSensitive("Latin1_General_CS_AS_KS_WS")).to.equal(true);
        expect(collationIsCaseSensitive("Latin1_General_BIN")).to.equal(true);
        expect(collationIsCaseSensitive("Latin1_General_BIN2")).to.equal(true);
        expect(collationIsCaseSensitive("Latin1_General_100_BIN2_UTF8")).to.equal(true);
        expect(collationIsCaseSensitive("SQL_Latin1_General_CP1_CI_AS")).to.equal(false);
        expect(collationIsCaseSensitive("Latin1_General_100_CI_AS_SC")).to.equal(false);
        expect(collationIsCaseSensitive("French_CI_AS")).to.equal(false);
        // "CS" as a substring of a language name must not match the token.
        expect(collationIsCaseSensitive("Czech_CI_AS")).to.equal(false);
    });

    test("hydration on a _BIN2 catalog: resolveName rejects folded-only matches", async () => {
        const scripts: FakeScript[] = [
            {
                match: (t) => t.includes("SERVERPROPERTY"),
                events: [
                    {
                        type: "resultSet",
                        columns: ["engine_edition", "default_schema", "collation_name"],
                        rows: [[5, "dbo", "Latin1_General_BIN2"]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
            {
                match: (t) => t.includes("sys.schemas"),
                events: [
                    { type: "resultSet", columns: ["schema_id", "name"], rows: [[1, "dbo"]] },
                    { type: "complete", status: "succeeded" },
                ],
            },
            {
                match: (t) => t.includes("FROM sys.objects o WHERE"),
                events: [
                    {
                        type: "resultSet",
                        columns: ["object_id", "schema_id", "name", "type", "modify_date"],
                        rows: [[101, 1, "Orders", "U", "2026-01-01T00:00:00"]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ];
        const service = serviceOver(scripts);
        const handle = service.acquire(KEY);
        await handle.refresh();
        const snapshot = handle.current()!;
        // BEFORE C-11 the _BIN2 collation classified as case-insensitive and
        // the folded-only lookup "guessed" a match the server would reject.
        expect(snapshot.caseSensitive).to.equal(true);
        expect(snapshot.resolveName(["orders"]).kind).to.equal("notFound");
        expect(snapshot.resolveName(["Orders"]).kind).to.equal("resolved");
        handle.dispose();
        service.dispose();
    });
});

// ---------------------------------------------------------------------------
// T-A3 — digest v2 rename detection (H-1)
// ---------------------------------------------------------------------------

suite("Metadata determinism: digest v2 rename detection (H-1)", () => {
    /** The fake server's catalog: hashes computed from tuples the way the
     *  two digest recipes ingest them. */
    interface FakeObjectRow {
        id: number;
        schemaId: number;
        name: string;
        modify: string;
    }
    const hashV2 = (objects: FakeObjectRow[]) =>
        objects.map((o) => `${o.id}|${o.schemaId}|${o.name}|${o.modify}`).join(";");
    const hashV1 = (objects: FakeObjectRow[]) =>
        objects.map((o) => `${o.id}|${o.modify}`).join(";");

    test("sp_rename outside the editor: v2 digest changes and forces re-hydrate; v1 recipe is blind", async () => {
        const objects: FakeObjectRow[] = [
            { id: 101, schemaId: 1, name: "Orders", modify: "2026-01-01T00:00:00" },
        ];
        const digestEvents = (): FakeScript["events"] => [
            {
                type: "resultSet",
                columns: ["current_db", "object_count", "object_hash"],
                rows: [["Db1", objects.length, hashV2(objects)]],
            },
            { type: "complete", status: "succeeded" },
        ];
        // The matcher doubles as the SQL-shape assertion: if CHEAP_DIGEST
        // loses DB_NAME()/schema_id/varbinary(256), nothing matches, the
        // digest check fails silently, and the drift assertion below fails.
        const digestFixture: FakeScript = {
            match: (t) =>
                t.includes("CHECKSUM_AGG") &&
                t.includes("DB_NAME()") &&
                t.includes("schema_id") &&
                t.includes("varbinary(256)"),
            events: digestEvents(),
        };
        const scripts: FakeScript[] = [
            digestFixture, // BEFORE H2: CHEAP_DIGEST contains H2's substring
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
                match: (t) => t.includes("sys.schemas"),
                events: [
                    { type: "resultSet", columns: ["schema_id", "name"], rows: [[1, "dbo"]] },
                    { type: "complete", status: "succeeded" },
                ],
            },
            {
                match: (t) => t.includes("FROM sys.objects o WHERE"),
                events: [
                    {
                        type: "resultSet",
                        columns: ["object_id", "schema_id", "name", "type", "modify_date"],
                        rows: [[101, 1, "Orders", "U", "2026-01-01T00:00:00"]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ];
        const service = serviceOver(scripts);
        const handle = service.acquire(KEY);
        // acquire kicks its own hydration and refresh() chains another, so
        // the baseline generation is whatever settled — capture, don't assume.
        await handle.refresh();
        const baseGeneration = handle.status().generation;
        expect(handle.status().readiness).to.equal("ready");

        // First EXEC sniff baselines the digest (no drift verdict yet).
        handle.notifyExecutedBatch({ text: "EXEC dbo.SomeProc", succeeded: true });
        await new Promise((r) => setTimeout(r, 25));
        expect(handle.status().generation).to.equal(baseGeneration);

        // sp_rename performed by SSMS/a teammate: name changes, object_id
        // and modify_date do NOT (the exact blind spot).
        const v1Before = hashV1(objects);
        objects[0].name = "OrdersRenamed";
        digestFixture.events = digestEvents();
        // The v1 recipe (object_id + modify_date only) cannot see it —
        // pinned so the v2 improvement can't silently regress.
        expect(hashV1(objects)).to.equal(v1Before);
        expect(hashV2(objects)).to.not.equal(hashV2([{ ...objects[0], name: "Orders" }]));

        // Second EXEC sniff: v2 digest mismatch ⇒ forced re-hydrate.
        handle.notifyExecutedBatch({ text: "EXEC dbo.SomeProc", succeeded: true });
        await new Promise((r) => setTimeout(r, 50));
        expect(handle.status().generation).to.equal(baseGeneration + 1);

        handle.dispose();
        service.dispose();
    });
});
