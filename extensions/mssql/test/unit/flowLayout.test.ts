/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import {
    DEFAULT_FLOW_LAYOUT_OPTIONS,
    layoutFlowComponents,
} from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner flow layout", () => {
    function createColumn(id: string, name: string): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey: false,
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

    function createTable(id: string, name: string): SchemaDesigner.Table {
        return {
            id,
            schema: "dbo",
            name,
            columns: [createColumn(`${id}-id`, "Id")],
            foreignKeys: [],
        };
    }

    test("exports default options based on standard spacing", () => {
        expect(DEFAULT_FLOW_LAYOUT_OPTIONS.rankdir).to.equal("LR");
        expect(DEFAULT_FLOW_LAYOUT_OPTIONS.marginx).to.equal(50);
        expect(DEFAULT_FLOW_LAYOUT_OPTIONS.marginy).to.equal(50);
        expect(DEFAULT_FLOW_LAYOUT_OPTIONS.nodesep).to.equal(50);
        expect(DEFAULT_FLOW_LAYOUT_OPTIONS.ranksep).to.equal(50);
    });

    test("lays out visible nodes and keeps edges intact", () => {
        const table1 = createTable("t1", "Users");
        const table2 = createTable("t2", "Orders");

        const nodes: Node<SchemaDesigner.Table>[] = [
            {
                id: table1.id,
                type: "tableNode",
                data: table1,
                position: { x: 0, y: 0 },
            } as Node<SchemaDesigner.Table>,
            {
                id: table2.id,
                type: "tableNode",
                data: table2,
                position: { x: 0, y: 0 },
            } as Node<SchemaDesigner.Table>,
        ];

        const edges: Edge<SchemaDesigner.ForeignKey>[] = [
            {
                id: "e1",
                source: "t1",
                target: "t2",
                data: {
                    id: "fk1",
                    name: "FK_1",
                    columnIds: ["c1"],
                    referencedTableId: "t2",
                    referencedColumnIds: ["c2"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
        ];

        const result = layoutFlowComponents(nodes, edges);

        expect(result.edges).to.equal(edges);
        expect(result.nodes).to.have.length(2);
        expect(
            result.nodes.some((node) => node.position.x !== 0 || node.position.y !== 0),
        ).to.equal(true);
    });

    test("does not move hidden nodes", () => {
        const table1 = createTable("t1", "Users");
        const table2 = createTable("t2", "Orders");

        const nodes: Node<SchemaDesigner.Table>[] = [
            {
                id: table1.id,
                type: "tableNode",
                data: table1,
                position: { x: 10, y: 20 },
                hidden: true,
            } as Node<SchemaDesigner.Table>,
            {
                id: table2.id,
                type: "tableNode",
                data: table2,
                position: { x: 0, y: 0 },
            } as Node<SchemaDesigner.Table>,
        ];

        const result = layoutFlowComponents(nodes, []);
        const hiddenNode = result.nodes.find((node) => node.id === "t1");

        expect(hiddenNode?.position).to.deep.equal({ x: 10, y: 20 });
    });
});
