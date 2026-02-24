/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ConnectionLineType } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { buildFlowComponentsFromSchema } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner schema to flow state", () => {
    function createColumn(id: string, name: string): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey: name === "Id",
            isIdentity: false,
            identitySeed: 0,
            identityIncrement: 0,
            isNullable: false,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
        };
    }

    test("creates nodes and per-column edges from id-based schema foreign keys", () => {
        const users: SchemaDesigner.Table = {
            id: "t-users",
            schema: "dbo",
            name: "Users",
            columns: [createColumn("c-users-id", "Id"), createColumn("c-users-alt", "AltId")],
            foreignKeys: [],
        };

        const orders: SchemaDesigner.Table = {
            id: "t-orders",
            schema: "dbo",
            name: "Orders",
            columns: [
                createColumn("c-orders-user-id", "UserId"),
                createColumn("c-orders-user-alt", "UserAltId"),
            ],
            foreignKeys: [
                {
                    id: "fk-orders-users",
                    name: "FK_Orders_Users",
                    columnsIds: ["c-orders-user-id", "c-orders-user-alt"],
                    referencedTableId: "t-users",
                    referencedColumnsIds: ["c-users-id", "c-users-alt"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const flow = buildFlowComponentsFromSchema({ tables: [users, orders] });

        expect(flow.nodes.map((node) => node.id).sort()).to.deep.equal(["t-orders", "t-users"]);
        expect(flow.edges).to.have.length(2);
        expect(flow.edges.map((edge) => edge.id)).to.deep.equal([
            "t-orders-t-users-c-orders-user-id-c-users-id",
            "t-orders-t-users-c-orders-user-alt-c-users-alt",
        ]);
        expect(flow.edges[0].data.columnsIds).to.deep.equal(["c-orders-user-id"]);
        expect(flow.edges[0].data.referencedColumnsIds).to.deep.equal(["c-users-id"]);
    });

    test("uses smooth-step edge for self-referencing foreign keys", () => {
        const employees: SchemaDesigner.Table = {
            id: "t-employees",
            schema: "dbo",
            name: "Employees",
            columns: [
                createColumn("c-emp-id", "Id"),
                createColumn("c-emp-manager-id", "ManagerId"),
            ],
            foreignKeys: [
                {
                    id: "fk-employees-manager",
                    name: "FK_Employees_Manager",
                    columnsIds: ["c-emp-manager-id"],
                    referencedTableId: "t-employees",
                    referencedColumnsIds: ["c-emp-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const flow = buildFlowComponentsFromSchema({ tables: [employees] });
        expect(flow.edges).to.have.length(1);
        expect(flow.edges[0].type).to.equal(ConnectionLineType.SmoothStep);
    });
});
