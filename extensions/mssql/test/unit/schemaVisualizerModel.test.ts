/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R2 canonical model + fingerprint + graph projection (visualizer
 * addendum §4, §5.7, §5.8, §17.2):
 * - REQUIRED INVARIANT: unchanged hydration at generation N and N+1 ⇒
 *   identical visualizer fingerprint ⇒ identical graph IDs (§17.1).
 * - No generation anywhere in node/column/edge ids (§4.4).
 * - Unknown facts stay unknown (§4.2): no fabricated identity (1,1), FK
 *   action label "Unknown" (never NO_ACTION), type facts unknown without
 *   cm2 detail.
 * - Failed sections limit CAPABILITIES — never an empty-success model.
 * - Deterministic ordering; self-referencing + composite FKs; dangling
 *   edges surfaced (raced DDL / subset), not silently dropped.
 * - Fingerprint moves on every commit-relevant change and ignores
 *   generation/timestamps/descriptions.
 */

import { expect } from "chai";
import {
    CatalogBuilder,
    CatalogSection,
    CatalogSnapshot,
    SectionState,
} from "../../src/services/metadata/catalogModel";
import { buildVisualizerModel } from "../../src/schemaVisualizer/model/catalogToVisualizerModel";
import { computeVisualizerFingerprint } from "../../src/schemaVisualizer/model/visualizerFingerprint";
import { projectGraph } from "../../src/schemaVisualizer/model/visualizerToGraphProjection";
import {
    SchemaVisualizerCatalogModel,
    availableValue,
} from "../../src/schemaVisualizer/model/schemaVisualizerModel";

const READY_ALL: Partial<Record<CatalogSection, SectionState>> = {
    schemas: "ready",
    objects: "ready",
    synonyms: "ready",
    types: "ready",
    columns: "ready",
    keys: "ready",
    foreignKeys: "ready",
    parameters: "ready",
    descriptions: "ready",
};

const IDENTITY = { serverFingerprint: "sfp_test", database: "Db1" };

/** Rich fixture: 2 tables, exact detail, composite + self-ref FKs. */
function buildRichSnapshot(generation: number): CatalogSnapshot {
    const b = new CatalogBuilder();
    b.setEnvironment({
        engineEdition: 3,
        defaultSchema: "dbo",
        collationName: "SQL_Latin1_General_CP1_CI_AS",
        caseSensitive: false,
    });
    b.addSchema(1, "dbo");
    // Insert out of objectId order on purpose — the model must sort.
    b.addObject(220, 1, "Customers", "table", "2026-01-02T00:00:00");
    b.addObject(210, 1, "Orders", "table", "2026-01-01T00:00:00");
    b.addColumn(210, "OrderId", "bigint", false, true, false, 1, {
        typeName: "bigint",
        typeSchema: "sys",
        baseTypeName: "bigint",
        systemTypeId: 127,
        userTypeId: 127,
        isUserDefined: false,
        isAssemblyType: false,
        maxLengthBytes: 8,
        precision: 19,
        scale: 0,
        identitySeedText: "9223372036854775806",
        identityIncrementText: "1",
    });
    b.addColumn(210, "CustomerId", "int", false, false, false, 2, {
        typeName: "int",
        typeSchema: "sys",
        baseTypeName: "int",
        systemTypeId: 56,
        userTypeId: 56,
        isUserDefined: false,
        isAssemblyType: false,
        maxLengthBytes: 4,
        precision: 10,
        scale: 0,
    });
    b.addColumn(210, "ParentOrderId", "bigint", true, false, false, 3, {
        typeName: "bigint",
        typeSchema: "sys",
        baseTypeName: "bigint",
        systemTypeId: 127,
        userTypeId: 127,
        isUserDefined: false,
        isAssemblyType: false,
        maxLengthBytes: 8,
        precision: 19,
        scale: 0,
    });
    b.addColumn(220, "CustomerId", "int", false, false, false, 1, {
        typeName: "int",
        typeSchema: "sys",
        baseTypeName: "int",
        systemTypeId: 56,
        userTypeId: 56,
        isUserDefined: false,
        isAssemblyType: false,
        maxLengthBytes: 4,
        precision: 10,
        scale: 0,
    });
    b.addColumn(220, "Region", "nvarchar(20)", true, false, false, 2, {
        typeName: "nvarchar",
        typeSchema: "sys",
        baseTypeName: "nvarchar",
        systemTypeId: 231,
        userTypeId: 231,
        isUserDefined: false,
        isAssemblyType: false,
        maxLengthBytes: 40,
        precision: 0,
        scale: 0,
        collationName: "SQL_Latin1_General_CP1_CI_AS",
    });
    b.markPrimaryKeyColumn(210, "OrderId");
    b.markPrimaryKeyColumn(220, "CustomerId");
    b.addKeyConstraintColumn(210, "PK_Orders", "primaryKey", "OrderId");
    b.addKeyConstraintColumn(220, "PK_Customers", "primaryKey", "CustomerId");
    // Composite FK Orders → Customers (two ordered pairs) + self-ref FK.
    b.addForeignKey(210, 220, "FK_Orders_Customers", 901, "CASCADE", "NO_ACTION");
    b.addForeignKeyColumn(901, "CustomerId", "CustomerId", 1, 2, 1);
    b.addForeignKeyColumn(901, "OrderId", "CustomerId", 2, 1, 1);
    b.addForeignKey(210, 210, "FK_Orders_Parent", 902, "NO_ACTION", "NO_ACTION");
    b.addForeignKeyColumn(902, "ParentOrderId", "OrderId", 1, 3, 1);
    b.addDescription(210, "Order header rows.");
    b.addDescription(210, "Customer reference.", "CustomerId");
    return b.build(generation, READY_ALL, "full");
}

function richModel(generation = 7): SchemaVisualizerCatalogModel {
    return buildVisualizerModel(buildRichSnapshot(generation), IDENTITY);
}

suite("Schema Visualizer model (SV-R2)", () => {
    test("REQUIRED INVARIANT: unchanged content, generation N vs N+1 ⇒ same fingerprint, same graph ids", () => {
        const modelA = richModel(7);
        const modelB = richModel(8);
        expect(modelA.source.generation).to.not.equal(modelB.source.generation);
        const fpA = computeVisualizerFingerprint(modelA);
        const fpB = computeVisualizerFingerprint(modelB);
        expect(fpA.hash).to.equal(fpB.hash);
        expect(fpA.hash).to.match(/^svf_[A-Za-z0-9_-]{22}$/);
        expect(fpA.complete).to.equal(true);
        const idsA = projectGraph(modelA);
        const idsB = projectGraph(modelB);
        expect(idsA.nodes.map((n) => n.id)).to.deep.equal(idsB.nodes.map((n) => n.id));
        expect(idsA.edges.map((e) => e.id)).to.deep.equal(idsB.edges.map((e) => e.id));
        // No generation digits smuggled into ids: exact expected shapes.
        expect(idsA.nodes.map((n) => n.id)).to.deep.equal(["table:210", "table:220"]);
        expect(idsA.edges.map((e) => e.id)).to.deep.equal(["fk:901", "fk:902"]);
        expect(idsA.nodes[0].columns.map((c) => c.id)).to.deep.equal([
            "column:210:1",
            "column:210:2",
            "column:210:3",
        ]);
    });

    test("deterministic ordering: tables by objectId (insert order was reversed)", () => {
        const model = richModel();
        expect(model.tables.map((t) => t.name)).to.deep.equal(["Orders", "Customers"]);
        expect(model.foreignKeys.map((fk) => fk.name)).to.deep.equal([
            "FK_Orders_Customers",
            "FK_Orders_Parent",
        ]);
    });

    test("exact facts land: identity TEXT, composite ordered pairs, actions, PK flags", () => {
        const model = richModel();
        const orders = model.tables[0];
        const orderId = orders.columns[0];
        expect(availableValue(orderId.identitySpec)).to.deep.equal({
            seedText: "9223372036854775806",
            incrementText: "1",
        });
        expect(availableValue(orderId.inPrimaryKey)).to.equal(true);
        expect(availableValue(orders.columns[1].inPrimaryKey)).to.equal(false);
        const compositeFk = model.foreignKeys[0];
        expect(compositeFk.columnPairs.map((p) => p.ordinal)).to.deep.equal([1, 2]);
        expect(availableValue(compositeFk.onDelete)).to.equal("CASCADE");
        const projection = projectGraph(model);
        const ordersNode = projection.nodeById.get("table:210")!;
        expect(ordersNode.columns[0].isPrimaryKey).to.equal(true);
        expect(ordersNode.columns[1].isForeignKey).to.equal(true);
        // Self-referencing FK renders as a normal edge, source === target.
        const selfEdge = projection.edges.find((e) => e.id === "fk:902")!;
        expect(selfEdge.sourceNodeId).to.equal("table:210");
        expect(selfEdge.targetNodeId).to.equal("table:210");
    });

    test("unknowns stay unknown (§4.2): no detail ⇒ type/identity unknown; FK action label 'Unknown'", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(300, 1, "Legacy", "table");
        // Old-shape column: no columnId, no detail — identity column whose
        // seed/increment were never captured.
        b.addColumn(300, "Id", "int", false, true, false);
        b.addForeignKey(300, 300, "FK_Legacy_Self", 950);
        b.addForeignKeyColumn(950, "Id", "Id");
        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const column = model.tables[0].columns[0];
        expect(column.type.state).to.equal("unknown");
        expect(column.identitySpec).to.deep.equal({ state: "unknown", reason: "notHydrated" });
        expect(column.defaultConstraint.state).to.equal("unknown");
        // Fallback ordinal-keyed id + identity grade capability downgraded.
        expect(column.graphId).to.equal("column:300:ord0");
        expect(model.capabilities.columnIdentityGrade.state).to.equal("limited");
        const fk = model.foreignKeys[0];
        expect(fk.onDelete.state).to.equal("unknown");
        const edge = projectGraph(model).edges[0];
        expect(edge.onDeleteLabel).to.equal("Unknown");
        expect(edge.onUpdateLabel).to.equal("Unknown");
    });

    test("failed sections limit capabilities — never empty success (§5.8)", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(310, 1, "T", "table");
        const failedColumns = buildVisualizerModel(
            b.build(1, { ...READY_ALL, columns: "failed" }, "partial"),
            IDENTITY,
        );
        expect(failedColumns.capabilities.diagramNodes).to.deep.equal({
            state: "limited",
            reason: "sectionUnavailable",
            failedSections: ["columns"],
        });
        expect(failedColumns.capabilities.relationshipEdges.state).to.equal("limited");
        expect(failedColumns.capabilities.tableList.state).to.equal("available");
        expect(computeVisualizerFingerprint(failedColumns).complete).to.equal(false);
        // A failed DESCRIPTIONS section must NOT limit the diagram.
        const failedDescriptions = buildVisualizerModel(buildRichSnapshot(1), IDENTITY);
        expect(failedDescriptions.capabilities.diagramNodes.state).to.equal("available");
        const b2 = new CatalogBuilder();
        b2.addSchema(1, "dbo");
        b2.addObject(311, 1, "T2", "table");
        b2.addColumn(311, "A", "int", false, false, false, 1);
        const noDescriptions = buildVisualizerModel(
            b2.build(1, { ...READY_ALL, descriptions: "failed" }, "partial"),
            IDENTITY,
        );
        expect(noDescriptions.capabilities.diagramNodes.state).to.equal("available");
        expect(noDescriptions.capabilities.descriptions.state).to.equal("limited");
        expect(noDescriptions.tables[0].description).to.deep.equal({
            state: "unknown",
            reason: "sectionUnavailable",
        });
    });

    test("dangling edges surfaced (raced DDL + subset filter), never silently dropped", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(400, 1, "A", "table");
        b.addColumn(400, "Id", "int", false, false, false, 1);
        // FK to object 999 which raced a DROP and is not in the catalog.
        b.addForeignKey(400, 999, "FK_A_Dropped", 970, "NO_ACTION", "NO_ACTION");
        b.addForeignKeyColumn(970, "Id", "Gone", 1, 1, 1);
        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const projection = projectGraph(model);
        expect(projection.edges).to.deep.equal([]);
        expect(projection.danglingEdges.map((e) => e.id)).to.deep.equal(["fk:970"]);

        // Subset filter: cross-boundary FK becomes dangling.
        const rich = richModel();
        const subset = projectGraph(rich, { includeObjectIds: new Set([210]) });
        expect(subset.nodes.map((n) => n.id)).to.deep.equal(["table:210"]);
        expect(subset.edges.map((e) => e.id)).to.deep.equal(["fk:902"]); // self-ref survives
        expect(subset.danglingEdges.map((e) => e.id)).to.deep.equal(["fk:901"]);
    });

    test("fingerprint moves on every commit-relevant change; ignores generation/timestamps/descriptions", () => {
        const baseline = computeVisualizerFingerprint(richModel()).hash;

        const mutations: Array<[string, (m: SchemaVisualizerCatalogModel) => void]> = [
            ["column rename", (m) => (m.tables[0].columns[0].name = "OrderKey")],
            ["nullability", (m) => (m.tables[0].columns[1].nullable = true)],
            [
                "type precision",
                (m) => {
                    const type = m.tables[0].columns[1].type;
                    if (type.state === "known") {
                        type.value.precision = 11;
                    }
                },
            ],
            [
                "identity seed text",
                (m) => {
                    const spec = m.tables[0].columns[0].identitySpec;
                    if (spec.state === "known") {
                        spec.value.seedText = "1";
                    }
                },
            ],
            [
                "FK action known→unknown",
                (m) => {
                    m.foreignKeys[0].onDelete = { state: "unknown", reason: "notHydrated" };
                },
            ],
            ["FK pair order", (m) => m.foreignKeys[0].columnPairs.reverse()],
            ["key constraint name", (m) => (m.tables[0].keyConstraints[0].name = "PK_X")],
            ["table schema", (m) => (m.tables[1].schema = "sales")],
            ["case sensitivity", (m) => (m.caseSensitive = true)],
        ];
        for (const [label, mutate] of mutations) {
            const model = richModel();
            mutate(model);
            expect(computeVisualizerFingerprint(model).hash, label).to.not.equal(baseline);
        }

        const insensitive: Array<[string, (m: SchemaVisualizerCatalogModel) => void]> = [
            ["generation", (m) => (m.source.generation = 999)],
            ["capturedAtUtc", (m) => (m.source.capturedAtUtc = "1999-01-01T00:00:00.000Z")],
            ["mode", (m) => (m.source.mode = "partial")],
            [
                "description",
                (m) => {
                    m.tables[0].description = { state: "known", value: "changed prose" };
                },
            ],
        ];
        for (const [label, mutate] of insensitive) {
            const model = richModel();
            mutate(model);
            expect(computeVisualizerFingerprint(model).hash, label).to.equal(baseline);
        }
    });
});
