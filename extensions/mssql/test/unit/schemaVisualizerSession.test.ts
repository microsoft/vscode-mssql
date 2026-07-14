/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R4 Schema Visualizer session (visualizer addendum §17.4/§17.5/§15):
 * - NO-V1 TRIPWIRE: every read flow (open, search, neighborhood, subset,
 *   refresh, drift) runs with ZERO SqlToolsService v1 requests and ZERO
 *   ConnectionManager connects — reads are MetadataStore leases over the
 *   data plane, full stop. The spy set matches the OE v2 tripwire exactly:
 *   any schemaDesigner/* call would trip `sendRequest` notCalled.
 * - Large-catalog policy (§11.3): above the threshold the default answer
 *   is search-first (no table payload); explicit subsets return tables +
 *   FKs touching them; FULL-catalog fingerprint rides both.
 * - Honesty (§15): failed columns section ⇒ limited diagram capability +
 *   incomplete fingerprint — never an empty-success model.
 * - Drift protocol (§6.1/§6.4): unchanged content re-hydration notifies
 *   with fingerprintChanged=false; a real DDL change flips it true.
 */

import { expect } from "chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import ConnectionManager from "../../src/controllers/connectionManager";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { MetadataStore } from "../../src/services/metadata/metadataStore";
import {
    prepareConnection,
    StoredConnectionProfile,
} from "../../src/services/metadata/profileAuthAdapter";
import {
    SchemaVisualizerSession,
    LARGE_CATALOG_RENDER_THRESHOLD,
} from "../../src/schemaVisualizer/schemaVisualizerSession";

type Row = (string | number | boolean | null)[];

const PROFILE: StoredConnectionProfile = {
    server: "srv-viz.example.internal",
    database: "DbViz",
    authenticationType: "Integrated",
    profileName: "Viz",
};

const NO_SECRETS = {
    lookupPassword: async () => {
        throw new Error("integrated auth must not look up a password");
    },
};

/**
 * Mutable catalog: `state` drives H2/H3/H5 row content so tests can change
 * the schema between hydrations (drift protocol) without a new backend.
 */
function mutableCatalogScripts(state: {
    tables: Array<{ id: number; name: string; columns: string[] }>;
    fks: Array<{ id: number; name: string; from: number; to: number; column: string }>;
    failColumns?: boolean;
}): FakeScript[] {
    const staticScript = (
        match: (t: string) => boolean,
        columns: string[],
        rows: Row[],
    ): FakeScript => ({
        match,
        events: [
            { type: "resultSet", columns, rows },
            { type: "complete", status: "succeeded" },
        ],
    });
    // FakeScript rows are captured at script definition; wrap in a getter
    // via `events` built lazily per match through a Proxy-free approach:
    // FakeBackend reads `events` each run, so a getter property suffices.
    const dynamic = (
        match: (t: string) => boolean,
        columns: string[],
        rows: () => Row[],
        fail?: () => boolean,
    ): FakeScript => {
        const script: FakeScript = { match } as FakeScript;
        Object.defineProperty(script, "events", {
            get() {
                if (fail?.()) {
                    return [
                        { type: "message", kind: "error", text: "permission denied" },
                        { type: "complete", status: "failed" },
                    ];
                }
                return [
                    { type: "resultSet", columns, rows: rows() },
                    { type: "complete", status: "succeeded" },
                ];
            },
        });
        return script;
    };
    return [
        staticScript(
            (t) => t.includes("SERVERPROPERTY"),
            ["engine_edition", "default_schema", "collation_name"],
            [[3, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
        ),
        staticScript(
            (t) => t.includes("is_primary_key"),
            ["object_id", "name", "index_name", "is_primary_key", "is_unique_constraint"],
            [],
        ),
        dynamic(
            (t) => t.includes("foreign_key_columns"),
            [
                "constraint_object_id",
                "parent_column",
                "referenced_column",
                "constraint_column_id",
                "parent_column_id",
                "referenced_column_id",
            ],
            () => state.fks.map((fk) => [fk.id, fk.column, fk.column, 1, 1, 1]),
        ),
        dynamic(
            (t) => t.includes("CHECKSUM_AGG"),
            ["current_db", "object_count", "object_hash"],
            () => [["DbViz", state.tables.length, state.tables.length * 31]],
        ),
        staticScript((t) => t.includes("sys.parameters"), ["object_id"], []),
        staticScript((t) => t.includes("extended_properties"), ["major_id"], []),
        staticScript((t) => t.includes("sys.schemas"), ["schema_id", "name"], [[1, "dbo"]]),
        dynamic(
            (t) => t.includes("FROM sys.objects o WHERE"),
            ["object_id", "schema_id", "name", "type", "modify_date"],
            () =>
                state.tables.map((table) => [table.id, 1, table.name, "U", "2026-01-01T00:00:00"]),
        ),
        dynamic(
            (t) => t.includes("sys.columns"),
            [
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
            () =>
                state.tables.flatMap((table) =>
                    table.columns.map(
                        (column, index): Row => [
                            table.id,
                            index + 1,
                            column,
                            "int",
                            4,
                            10,
                            0,
                            false,
                            false,
                            false,
                        ],
                    ),
                ),
            () => state.failColumns === true,
        ),
        dynamic(
            (t) => t.includes("sys.foreign_keys"),
            [
                "object_id",
                "name",
                "parent_object_id",
                "referenced_object_id",
                "delete_referential_action_desc",
                "update_referential_action_desc",
            ],
            () => state.fks.map((fk) => [fk.id, fk.name, fk.from, fk.to, "NO_ACTION", "NO_ACTION"]),
        ),
    ];
}

function harness(state: Parameters<typeof mutableCatalogScripts>[0], renderThreshold?: number) {
    const backend = new FakeBackend({ scripts: mutableCatalogScripts(state) });
    const store = new MetadataStore(async () => backend, { pollSeconds: 0 });
    const prepared = prepareConnection(PROFILE, NO_SECRETS);
    const session = new SchemaVisualizerSession(store, {
        prepared,
        database: "DbViz",
        ...(renderThreshold !== undefined ? { renderThreshold } : {}),
    });
    return { backend, store, session };
}

const SMALL_STATE = () => ({
    tables: [
        { id: 501, name: "Orders", columns: ["OrderId", "CustomerId"] },
        { id: 502, name: "Customers", columns: ["CustomerId", "Name"] },
        { id: 503, name: "Regions", columns: ["RegionId"] },
    ],
    fks: [{ id: 901, name: "FK_Orders_Customers", from: 501, to: 502, column: "CustomerId" }],
});

suite("Schema Visualizer session (SV-R4)", () => {
    let sendRequest: sinon.SinonSpy;
    let connect: sinon.SinonSpy;

    setup(() => {
        sendRequest = sinon.spy(SqlToolsServiceClient.prototype, "sendRequest");
        connect = sinon.spy(ConnectionManager.prototype, "connect");
    });

    teardown(() => {
        // THE TRIPWIRE (§17.5): the read path NEVER touches STS v1 — no
        // schemaDesigner/* session, no getDefinition, no classic connect.
        sinon.assert.notCalled(sendRequest);
        sinon.assert.notCalled(connect);
        sendRequest.restore();
        connect.restore();
    });

    test("open serves the full model for small catalogs; facts are honest", async () => {
        const { session, store } = harness(SMALL_STATE());
        const result = await session.getModel();
        expect(result.searchFirst).to.equal(false);
        expect(result.totalTables).to.equal(3);
        expect(result.renderedTables).to.equal(3);
        expect(result.model.foreignKeys.length).to.equal(1);
        expect(result.fingerprint).to.match(/^svf_/);
        expect(result.fingerprintComplete).to.equal(true);
        expect(["live", "validated"]).to.include(result.freshness.freshness);
        expect(result.model.capabilities.diagramNodes.state).to.equal("available");
        session.dispose();
        store.dispose();
    });

    test("large-catalog policy: search-first default, explicit subsets, FK neighborhood (§11.3)", async () => {
        const { session, store } = harness(SMALL_STATE(), 2); // threshold below 3 tables
        const first = await session.getModel();
        expect(first.searchFirst).to.equal(true);
        expect(first.renderedTables).to.equal(0);
        expect(first.totalTables).to.equal(3);
        // Fingerprint covers the FULL catalog even when nothing renders.
        expect(first.fingerprint).to.match(/^svf_/);

        const search = await session.searchTables("ord");
        expect(search.map((item) => item.name)).to.deep.equal(["Orders"]);
        expect(search[0].columnCount).to.equal(2);

        const neighborhood = await session.fkNeighborhood([501]);
        expect(neighborhood.sort()).to.deep.equal([501, 502]);

        const subset = await session.getModel({ objectIds: neighborhood });
        expect(subset.searchFirst).to.equal(false);
        expect(subset.renderedTables).to.equal(2);
        expect(subset.model.foreignKeys.length).to.equal(1);
        // Same catalog ⇒ same fingerprint regardless of the subset (§5.7).
        expect(subset.fingerprint).to.equal(first.fingerprint);
        session.dispose();
        store.dispose();
    });

    test("honesty: failed columns section ⇒ limited capability + incomplete fingerprint, never empty success", async () => {
        const state = { ...SMALL_STATE(), failColumns: true };
        const { session, store } = harness(state);
        const result = await session.getModel();
        expect(result.model.capabilities.diagramNodes.state).to.equal("limited");
        expect(result.fingerprintComplete).to.equal(false);
        // Tables list (objects section) is still served — the FAILURE is
        // scoped, the diagram capability carries it (§5.8).
        expect(result.totalTables).to.equal(3);
        session.dispose();
        store.dispose();
    });

    test("drift protocol (§6.1/§6.4): unchanged refresh ⇒ fingerprintChanged=false; DDL ⇒ true", async () => {
        const state = SMALL_STATE();
        const { session, store } = harness(state);
        const events: boolean[] = [];
        session.onDidChange((event) => events.push(event.fingerprintChanged));

        const first = await session.getModel();

        // Refresh over IDENTICAL content: generation bumps, content doesn't.
        const unchanged = await session.refresh();
        expect(unchanged.fingerprint).to.equal(first.fingerprint);
        expect(unchanged.model.source.generation).to.be.greaterThan(first.model.source.generation);
        expect(events.length).to.be.greaterThan(0);
        expect(
            events.every((changed) => changed === false),
            "no drift on unchanged content",
        ).to.equal(true);

        // Real DDL: a new column lands.
        events.length = 0;
        state.tables[0].columns.push("Total");
        const changed = await session.refresh();
        expect(changed.fingerprint).to.not.equal(first.fingerprint);
        expect(events).to.include(true);
        session.dispose();
        store.dispose();
    });

    test("threshold default matches the documented internal policy", () => {
        expect(LARGE_CATALOG_RENDER_THRESHOLD).to.equal(500);
    });
});
