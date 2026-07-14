/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R6 edit reducer / normalization / rebase (addendum §7, §17.3):
 * every first-release operation, rename→property-change sequencing,
 * add-then-drop cancellation, repeated-set coalescing (last wins),
 * drop-cascade, FK-after-structure ordering (FKs to renamed/new tables
 * apply), undo/redo as a pure cursor, rebase success + conflicts, case
 * sensitivity, and typed rejection of unsupported kinds. Pure — no vscode.
 */

import { expect } from "chai";
import {
    CatalogBuilder,
    CatalogSection,
    SectionState,
} from "../../src/services/metadata/catalogModel";
import { buildVisualizerModel } from "../../src/schemaVisualizer/model/catalogToVisualizerModel";
import { SchemaVisualizerEditOp } from "../../src/schemaVisualizer/model/schemaVisualizerEdit";
import {
    applyEdit,
    buildEditableModel,
    normalizeOperations,
    rebaseOperations,
} from "../../src/schemaVisualizer/model/schemaVisualizerEditReducer";
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

function baseline(caseSensitive = false): SchemaVisualizerCatalogModel {
    const b = new CatalogBuilder();
    b.setEnvironment({ defaultSchema: "dbo", caseSensitive });
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

const ORDERS = {
    kind: "existing" as const,
    objectId: 101,
    baselineSchema: "dbo",
    baselineName: "Orders",
};
const CUSTOMERS = {
    kind: "existing" as const,
    objectId: 102,
    baselineSchema: "dbo",
    baselineName: "Customers",
};

let opCounter = 0;
function op<T extends SchemaVisualizerEditOp["kind"]>(
    kind: T,
    body: Omit<Extract<SchemaVisualizerEditOp, { kind: T }>, "version" | "operationId" | "kind">,
): Extract<SchemaVisualizerEditOp, { kind: T }> {
    return {
        version: 1,
        operationId: `op-${++opCounter}`,
        kind,
        ...body,
    } as Extract<SchemaVisualizerEditOp, { kind: T }>;
}

const INT_TYPE = { displayText: "int", typeName: "int" };

suite("Schema Visualizer edit reducer (SV-R6)", () => {
    test("every first-release operation applies", () => {
        const ops: SchemaVisualizerEditOp[] = [
            op("addTable", {
                table: {
                    localId: "t1",
                    schema: "dbo",
                    name: "Regions",
                    columns: [{ localId: "c1", name: "RegionId", type: INT_TYPE, nullable: false }],
                },
            }),
            op("addColumn", {
                table: { kind: "new", localId: "t1" },
                column: {
                    localId: "c2",
                    name: "Name",
                    type: { displayText: "nvarchar(50)", typeName: "nvarchar", length: 50 },
                    nullable: true,
                },
            }),
            op("renameTable", { table: ORDERS, newName: "SalesOrders" }),
            op("setTableSchema", { table: CUSTOMERS, newSchema: "sales" }),
            op("renameColumn", {
                table: ORDERS,
                column: { kind: "existing", columnId: 1, baselineName: "OrderId" },
                newName: "OrderKey",
            }),
            op("setColumnType", {
                table: ORDERS,
                column: { kind: "existing", columnId: 2, baselineName: "CustomerId" },
                newType: { displayText: "bigint", typeName: "bigint" },
            }),
            op("setColumnNullability", {
                table: ORDERS,
                column: { kind: "existing", columnId: 2, baselineName: "CustomerId" },
                nullable: true,
            }),
            op("setForeignKeyActions", {
                foreignKey: {
                    kind: "existing",
                    constraintObjectId: 901,
                    baselineName: "FK_Orders_Customers",
                },
                onDelete: "CASCADE",
                onUpdate: "NO_ACTION",
            }),
            op("addForeignKey", {
                foreignKey: {
                    localId: "fk1",
                    name: "FK_Regions_Customers",
                    fromTable: { kind: "new", localId: "t1" },
                    toTable: CUSTOMERS,
                    columnPairs: [
                        {
                            fromColumn: { kind: "new", localId: "c1" },
                            toColumn: { kind: "existing", columnId: 1, baselineName: "CustomerId" },
                        },
                    ],
                    onDelete: "SET_NULL",
                    onUpdate: "NO_ACTION",
                },
            }),
        ];
        const outcome = rebaseOperations(baseline(), normalizeOperations(ops));
        expect(outcome.state).to.equal("clean");
        if (outcome.state !== "clean") {
            return;
        }
        const tables = [...outcome.model.tables.values()];
        expect(tables.map((t) => `${t.schema}.${t.name}`).sort()).to.deep.equal([
            "dbo.Regions",
            "dbo.SalesOrders",
            "sales.Customers",
        ]);
        const orders = tables.find((t) => t.name === "SalesOrders")!;
        expect(orders.columns.map((c) => c.name)).to.deep.equal(["OrderKey", "CustomerId"]);
        expect(orders.columns[1].typeDisplay).to.equal("bigint");
        expect(orders.columns[1].nullable).to.equal(true);
        // Baseline names survive for correlation (§6.6).
        expect(orders.columns[0].baselineName).to.equal("OrderId");
        expect(orders.baselineName).to.equal("Orders");
        const fks = [...outcome.model.foreignKeys.values()];
        expect(fks.map((fk) => fk.name).sort()).to.deep.equal([
            "FK_Orders_Customers",
            "FK_Regions_Customers",
        ]);
        expect(fks.find((fk) => fk.name === "FK_Orders_Customers")!.onDelete).to.equal("CASCADE");
    });

    test("drop cascades: dropTable removes its FKs and later edits normalize away", () => {
        const ops = [
            op("renameColumn", {
                table: ORDERS,
                column: { kind: "existing", columnId: 1, baselineName: "OrderId" },
                newName: "Zombie",
            }),
            op("dropTable", { table: ORDERS }),
        ];
        const normalized = normalizeOperations(ops);
        // The rename to a soon-dropped table's column normalizes away.
        expect(normalized.map((o) => o.kind)).to.deep.equal(["dropTable"]);
        const outcome = rebaseOperations(baseline(), normalized);
        expect(outcome.state).to.equal("clean");
        if (outcome.state !== "clean") {
            return;
        }
        expect([...outcome.model.tables.values()].map((t) => t.name)).to.deep.equal(["Customers"]);
        expect(outcome.model.foreignKeys.size).to.equal(0); // FK went with the table
    });

    test("normalization: add-then-drop of a NEW entity cancels entirely", () => {
        const ops = [
            op("addTable", {
                table: { localId: "tx", schema: "dbo", name: "Temp", columns: [] },
            }),
            op("renameTable", { table: { kind: "new", localId: "tx" }, newName: "Temp2" }),
            op("dropTable", { table: { kind: "new", localId: "tx" } }),
        ];
        expect(normalizeOperations(ops)).to.deep.equal([]);
    });

    test("normalization: repeated property sets coalesce to the LAST value; FK ops order after structure", () => {
        const rename1 = op("renameTable", { table: ORDERS, newName: "A" });
        const fkAction = op("setForeignKeyActions", {
            foreignKey: {
                kind: "existing",
                constraintObjectId: 901,
                baselineName: "FK_Orders_Customers",
            },
            onDelete: "SET_NULL",
            onUpdate: "NO_ACTION",
        });
        const rename2 = op("renameTable", { table: ORDERS, newName: "B" });
        const normalized = normalizeOperations([rename1, fkAction, rename2]);
        expect(normalized.map((o) => o.operationId)).to.deep.equal([
            rename2.operationId, // rename coalesced to the last
            fkAction.operationId, // FK op partitioned after structure
        ]);
        const outcome = rebaseOperations(baseline(), normalized);
        expect(outcome.state).to.equal("clean");
        if (outcome.state === "clean") {
            expect(
                [...outcome.model.tables.values()].find((t) => t.baselineName === "Orders")!.name,
            ).to.equal("B");
        }
    });

    test("undo/redo is a pure cursor over the log", () => {
        const ops = [
            op("renameTable", { table: ORDERS, newName: "Step1" }),
            op("renameTable", { table: ORDERS, newName: "Step2" }),
        ];
        const base = baseline();
        const at = (cursor: number) => {
            const outcome = rebaseOperations(base, ops.slice(0, cursor));
            expect(outcome.state).to.equal("clean");
            return outcome.state === "clean"
                ? [...outcome.model.tables.values()].find((t) => t.baselineName === "Orders")!.name
                : "";
        };
        expect(at(0)).to.equal("Orders");
        expect(at(1)).to.equal("Step1");
        expect(at(2)).to.equal("Step2");
        expect(at(1)).to.equal("Step1"); // undo = cursor left; redo = right
    });

    test("rebase conflict: op targeting a vanished table stops replay with a typed conflict", () => {
        const ops = [
            op("renameTable", { table: CUSTOMERS, newName: "Clients" }),
            op("renameTable", {
                table: {
                    kind: "existing",
                    objectId: 999,
                    baselineSchema: "dbo",
                    baselineName: "Gone",
                },
                newName: "Nope",
            }),
            op("renameTable", { table: ORDERS, newName: "NeverApplied" }),
        ];
        const outcome = rebaseOperations(baseline(), ops);
        expect(outcome.state).to.equal("conflict");
        if (outcome.state === "conflict") {
            expect(outcome.conflict.code).to.equal("targetNotFound");
            expect(outcome.conflict.operationId).to.equal(ops[1].operationId);
            expect(outcome.appliedCount).to.equal(1);
        }
    });

    test("duplicate names honor catalog case sensitivity", () => {
        const rename = op("renameTable", { table: ORDERS, newName: "CUSTOMERS" });
        // Case-insensitive catalog: CUSTOMERS collides with Customers.
        const insensitive = applyEdit(buildEditableModel(baseline(false)), rename);
        expect(insensitive.ok).to.equal(false);
        if (insensitive.ok === false) {
            expect(insensitive.conflict.code).to.equal("duplicateName");
        }
        // Case-sensitive catalog: distinct binary names coexist.
        const sensitive = applyEdit(buildEditableModel(baseline(true)), rename);
        expect(sensitive.ok).to.equal(true);
    });

    test("unsupported operation kinds are rejected, never silently applied", () => {
        const bogus = {
            version: 1,
            operationId: "op-bogus",
            kind: "setColumnIdentity",
        } as unknown as SchemaVisualizerEditOp;
        const result = applyEdit(buildEditableModel(baseline()), bogus);
        expect(result.ok).to.equal(false);
        if (result.ok === false) {
            expect(result.conflict.code).to.equal("unsupportedOperation");
        }
    });

    test("reducer purity: input model is never mutated", () => {
        const model = buildEditableModel(baseline());
        const before = JSON.stringify([...model.tables.values()]);
        applyEdit(model, op("renameTable", { table: ORDERS, newName: "Mutant" }));
        expect(JSON.stringify([...model.tables.values()])).to.equal(before);
    });
});
