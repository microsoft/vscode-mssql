/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { applyDeleteTableMutation } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner delete table mutation", () => {
    function createTable(id: string, name: string): SchemaDesigner.Table {
        return {
            id,
            name,
            schema: "dbo",
            columns: [],
            foreignKeys: [],
        };
    }

    function createNode(table: SchemaDesigner.Table): Node<SchemaDesigner.Table> {
        return {
            id: table.id,
            type: "tableNode",
            data: table,
            position: { x: 0, y: 0 },
        } as Node<SchemaDesigner.Table>;
    }

    test("returns failure when table node does not exist", () => {
        const result = applyDeleteTableMutation({
            tableId: "missing-table",
            existingNodes: [],
            skipConfirmation: false,
        });

        expect(result.success).to.equal(false);
    });

    test("returns node and skip flag for existing table", () => {
        const table = createTable("table-1", "Users");

        const result = applyDeleteTableMutation({
            tableId: table.id,
            existingNodes: [createNode(table)],
            skipConfirmation: true,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.nodeToDelete.id).to.equal(table.id);
        expect(result.shouldSkipDeleteConfirmation).to.equal(true);
    });

    test("preserves skip flag as false when not provided", () => {
        const table = createTable("table-2", "Orders");

        const result = applyDeleteTableMutation({
            tableId: table.id,
            existingNodes: [createNode(table)],
            skipConfirmation: false,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.shouldSkipDeleteConfirmation).to.equal(false);
    });
});
