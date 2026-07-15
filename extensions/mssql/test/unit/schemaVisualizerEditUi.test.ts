/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R8c edit-capture seams (pure — no React render):
 * - schemaVisualizerTableDraft: draft↔ops diff is IDENTITY-based (renames
 *   stay renames, never drop+add), validation refusals, type-picker facts;
 * - projectEditableGraph: edited-model canvas projection keeps baseline
 *   graph ids for existing entities (positions/selection survive edit
 *   mode), joins baseline-only facts by column identity, and projects new
 *   entities under new-* ids;
 * - collectGraphEditStates: change-highlight classes from the op log.
 */

import { expect } from "chai";
import {
    CatalogBuilder,
    CatalogSection,
    SectionState,
} from "../../src/services/metadata/catalogModel";
import { buildVisualizerModel } from "../../src/schemaVisualizer/model/catalogToVisualizerModel";
import {
    applyEdit,
    buildEditableModel,
    EditableModel,
} from "../../src/schemaVisualizer/model/schemaVisualizerEditReducer";
import {
    collectGraphEditStates,
    projectEditableGraph,
} from "../../src/schemaVisualizer/model/projectEditableGraph";
import {
    buildTableDraft,
    buildTypeSpec,
    diffTableDraft,
    newTableDraftToOps,
    TableDraft,
} from "../../src/schemaVisualizer/model/schemaVisualizerTableDraft";
import { SchemaVisualizerEditOp } from "../../src/schemaVisualizer/model/schemaVisualizerEdit";
import { SchemaVisualizerCatalogModel } from "../../src/schemaVisualizer/model/schemaVisualizerModel";

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

const INT_DETAIL = {
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
};

function baseline(): SchemaVisualizerCatalogModel {
    const b = new CatalogBuilder();
    b.setEnvironment({ defaultSchema: "dbo", caseSensitive: false });
    b.addSchema(1, "dbo");
    b.addObject(101, 1, "Orders", "table");
    b.addObject(102, 1, "Customers", "table");
    b.addColumn(101, "OrderId", "int", false, false, false, 1, INT_DETAIL);
    b.addColumn(101, "CustomerId", "int", false, false, false, 2, INT_DETAIL);
    b.addColumn(102, "CustomerId", "int", false, false, false, 1, INT_DETAIL);
    b.addForeignKey(101, 102, "FK_Orders_Customers", 901, "NO_ACTION", "NO_ACTION");
    b.addForeignKeyColumn(901, "CustomerId", "CustomerId", 1, 2, 1);
    return buildVisualizerModel(b.build(1, READY_ALL, "full"), {
        serverFingerprint: "sfp_test",
        database: "Db1",
    });
}

function sequentialIds(): () => string {
    let n = 0;
    return () => `op-${++n}`;
}

function editable(model: SchemaVisualizerCatalogModel): EditableModel {
    return buildEditableModel(model);
}

function ordersTable(model: EditableModel) {
    const table = model.tables.get("t:101");
    expect(table, "Orders editable table").to.not.equal(undefined);
    return table!;
}

suite("Schema Visualizer edit-capture seams (SV-R8c)", () => {
    suite("diffTableDraft", () => {
        test("an untouched draft yields zero ops", () => {
            const current = ordersTable(editable(baseline()));
            const draft = buildTableDraft(current);
            const result = diffTableDraft(current, draft, sequentialIds());
            expect(result.errors).to.deep.equal([]);
            expect(result.ops).to.deep.equal([]);
        });

        test("renames are identity-based ops, never drop+add", () => {
            const current = ordersTable(editable(baseline()));
            const draft = buildTableDraft(current);
            draft.name = "SalesOrders";
            draft.columns[0].name = "SalesOrderId";
            const result = diffTableDraft(current, draft, sequentialIds());
            expect(result.errors).to.deep.equal([]);
            expect(result.ops.map((op) => op.kind)).to.deep.equal(["renameTable", "renameColumn"]);
            const rename = result.ops[1] as Extract<
                SchemaVisualizerEditOp,
                { kind: "renameColumn" }
            >;
            expect(rename.column).to.deep.equal({
                kind: "existing",
                columnId: 1,
                baselineName: "OrderId",
            });
            expect(rename.newName).to.equal("SalesOrderId");
        });

        test("type, nullability, drop, and add changes emit their ops", () => {
            const current = ordersTable(editable(baseline()));
            const draft = buildTableDraft(current);
            draft.columns[0].editedType = buildTypeSpec("bigint");
            draft.columns[1].nullable = true;
            draft.columns.splice(1, 1, {
                ...draft.columns[1],
            });
            // Drop CustomerId, add a new column.
            const dropped = draft.columns.splice(1, 1)[0];
            expect(dropped.name).to.equal("CustomerId");
            draft.columns.push({
                ref: { kind: "new", localId: "local-1" },
                name: "Notes",
                typeDisplay: "nvarchar(100)",
                editedType: buildTypeSpec("nvarchar", { length: 100 }),
                nullable: true,
            });
            const result = diffTableDraft(current, draft, sequentialIds());
            expect(result.errors).to.deep.equal([]);
            expect(result.ops.map((op) => op.kind)).to.deep.equal([
                "setColumnType",
                "dropColumn",
                "addColumn",
            ]);
            const retype = result.ops[0] as Extract<
                SchemaVisualizerEditOp,
                { kind: "setColumnType" }
            >;
            expect(retype.newType.typeName).to.equal("bigint");
            expect(retype.beforeDisplayText).to.equal("int");
        });

        test("refuses empty names, duplicate columns, and empty tables", () => {
            const current = ordersTable(editable(baseline()));
            const empty = buildTableDraft(current);
            empty.name = " ";
            expect(diffTableDraft(current, empty, sequentialIds()).errors).to.not.deep.equal([]);

            const dup = buildTableDraft(current);
            dup.columns[1].name = "orderid"; // CI duplicate of OrderId
            expect(diffTableDraft(current, dup, sequentialIds()).errors).to.not.deep.equal([]);

            const none = buildTableDraft(current);
            none.columns = [];
            expect(diffTableDraft(current, none, sequentialIds()).errors).to.not.deep.equal([]);
        });
    });

    suite("newTableDraftToOps", () => {
        test("a valid new-table draft becomes one addTable op", () => {
            const draft: TableDraft = {
                table: { kind: "new", localId: "nt-1" },
                schema: "dbo",
                name: "AuditLog",
                columns: [
                    {
                        ref: { kind: "new", localId: "nc-1" },
                        name: "Id",
                        typeDisplay: "int",
                        editedType: buildTypeSpec("int"),
                        nullable: false,
                    },
                ],
            };
            const result = newTableDraftToOps(draft, sequentialIds());
            expect(result.errors).to.deep.equal([]);
            expect(result.ops).to.have.length(1);
            const add = result.ops[0] as Extract<SchemaVisualizerEditOp, { kind: "addTable" }>;
            expect(add.table.localId).to.equal("nt-1");
            expect(add.table.columns[0].type.typeName).to.equal("int");
        });

        test("a new column without a picked type is refused", () => {
            const draft: TableDraft = {
                table: { kind: "new", localId: "nt-1" },
                schema: "dbo",
                name: "AuditLog",
                columns: [
                    {
                        ref: { kind: "new", localId: "nc-1" },
                        name: "Id",
                        typeDisplay: "int",
                        nullable: false,
                    },
                ],
            };
            const result = newTableDraftToOps(draft, sequentialIds());
            expect(result.errors.join(" ")).to.contain("needs a type");
        });
    });

    suite("buildTypeSpec", () => {
        test("builds discrete facts and display text from picker parts", () => {
            expect(buildTypeSpec("int")).to.deep.equal({ displayText: "int", typeName: "int" });
            expect(buildTypeSpec("nvarchar", { length: 100 })).to.deep.equal({
                displayText: "nvarchar(100)",
                typeName: "nvarchar",
                length: 100,
            });
            expect(buildTypeSpec("varbinary", { length: "max" })).to.deep.equal({
                displayText: "varbinary(max)",
                typeName: "varbinary",
                length: "max",
            });
            expect(buildTypeSpec("decimal", { precision: 18, scale: 4 })).to.deep.equal({
                displayText: "decimal(18,4)",
                typeName: "decimal",
                precision: 18,
                scale: 4,
            });
        });
    });

    suite("projectEditableGraph", () => {
        test("existing entities keep baseline graph ids; edited names render", () => {
            const model = baseline();
            let edited = editable(model);
            const renamed = applyEdit(edited, {
                version: 1,
                operationId: "op-1",
                kind: "renameColumn",
                table: {
                    kind: "existing",
                    objectId: 101,
                    baselineSchema: "dbo",
                    baselineName: "Orders",
                },
                column: { kind: "existing", columnId: 1, baselineName: "OrderId" },
                newName: "SalesOrderId",
            });
            expect(renamed.ok).to.equal(true);
            if (renamed.ok === false) {
                return;
            }
            edited = renamed.model;
            const projection = projectEditableGraph(edited, model);
            const orders = projection.nodeById.get("table:101");
            expect(orders, "orders node id survives edit mode").to.not.equal(undefined);
            expect(orders!.columns[0].name).to.equal("SalesOrderId");
            // FK edge id stays the baseline constraint id.
            expect(projection.edges.map((edge) => edge.id)).to.deep.equal(["fk:901"]);
            // Baseline-only facts joined by identity (no fabrication).
            expect(orders!.columns[0].isIdentity).to.equal(false);
        });

        test("new tables project under new-* ids; dropped tables leave the graph", () => {
            const model = baseline();
            let edited = editable(model);
            const added = applyEdit(edited, {
                version: 1,
                operationId: "op-1",
                kind: "addTable",
                table: {
                    localId: "nt-1",
                    schema: "dbo",
                    name: "AuditLog",
                    columns: [
                        {
                            localId: "nc-1",
                            name: "Id",
                            type: buildTypeSpec("int"),
                            nullable: false,
                        },
                    ],
                },
            });
            expect(added.ok).to.equal(true);
            if (added.ok === false) {
                return;
            }
            edited = added.model;
            const projection = projectEditableGraph(edited, model);
            const audit = projection.nodeById.get("new-table:nt-1");
            expect(audit).to.not.equal(undefined);
            expect(audit!.columns[0].typeDisplay).to.equal("int");
            expect(audit!.columns[0].isPrimaryKey).to.equal(false);
        });
    });

    suite("collectGraphEditStates", () => {
        test("added wins over modified; ops map to graph ids", () => {
            const states = collectGraphEditStates([
                {
                    version: 1,
                    operationId: "op-1",
                    kind: "addTable",
                    table: { localId: "nt-1", schema: "dbo", name: "T", columns: [] },
                },
                {
                    version: 1,
                    operationId: "op-2",
                    kind: "renameTable",
                    table: {
                        kind: "existing",
                        objectId: 101,
                        baselineSchema: "dbo",
                        baselineName: "Orders",
                    },
                    newName: "SalesOrders",
                },
                {
                    version: 1,
                    operationId: "op-3",
                    kind: "setForeignKeyActions",
                    foreignKey: { kind: "existing", constraintObjectId: 901, baselineName: "FK" },
                    onDelete: "CASCADE",
                    onUpdate: "NO_ACTION",
                },
            ]);
            expect(states.nodes.get("new-table:nt-1")).to.equal("added");
            expect(states.nodes.get("table:101")).to.equal("modified");
            expect(states.edges.get("fk:901")).to.equal("modified");
        });
    });
});
