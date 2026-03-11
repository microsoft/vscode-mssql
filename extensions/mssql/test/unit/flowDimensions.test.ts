/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import {
    BASE_NODE_HEIGHT,
    COLUMN_HEIGHT,
    NODE_MARGIN,
    NODE_WIDTH,
    getTableHeight,
    getTableWidth,
} from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner flow dimensions", () => {
    function createTable(columnCount: number): SchemaDesigner.Table {
        return {
            id: "t1",
            schema: "dbo",
            name: "Users",
            columns: Array.from({ length: columnCount }, (_, index) => ({
                id: `c${index}`,
                name: `col${index}`,
                dataType: "int",
                maxLength: "",
                precision: 10,
                scale: 0,
                isPrimaryKey: false,
                isIdentity: false,
                identitySeed: 0,
                identityIncrement: 0,
                isNullable: true,
                defaultValue: "",
                isComputed: false,
                computedFormula: "",
                computedPersisted: false,
            })),
            foreignKeys: [],
        };
    }

    test("computes table width from node width and margin", () => {
        expect(getTableWidth()).to.equal(NODE_WIDTH + NODE_MARGIN);
    });

    test("computes table height from base height and column count", () => {
        expect(getTableHeight(createTable(0))).to.equal(BASE_NODE_HEIGHT);
        expect(getTableHeight(createTable(3))).to.equal(BASE_NODE_HEIGHT + 3 * COLUMN_HEIGHT);
    });
});
