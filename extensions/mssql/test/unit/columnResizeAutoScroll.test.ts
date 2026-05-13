/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getColumnResizeWidth } from "../../src/webviews/pages/QueryResult/table/plugins/columnResizeAutoScroll.plugin";

suite("ColumnResizeAutoScroll", () => {
    test("adds pointer and auto-scroll deltas to the starting width", () => {
        expect(getColumnResizeWidth(120, 25, 18, 50)).to.equal(163);
    });

    test("clamps resized width to the minimum column width", () => {
        expect(getColumnResizeWidth(120, -100, -30, 50)).to.equal(50);
    });

    test("clamps resized width to the maximum column width", () => {
        expect(getColumnResizeWidth(120, 200, 30, 50, 250)).to.equal(250);
    });
});
