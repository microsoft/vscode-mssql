/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RowStore } from "../../../src/queryStudio/rowStore";

suite("Query Studio RowStore", () => {
    test("serves high-offset windows from many small pages", () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir);
        try {
            store.beginResultSet("r0", [
                { name: "id", displayName: "id" },
                { name: "name", displayName: "name" },
            ]);
            for (let i = 0; i < 1000; i++) {
                store.appendPage("r0", {
                    rowOffset: i,
                    rowCount: 1,
                    approxBytes: 16,
                    compact: { values: [[i, `value-${i}`]] },
                });
            }

            const window = store.getRows("r0", 995, 3);

            expect(window.rowCount).to.equal(3);
            expect(window.values).to.deep.equal([
                [995, "value-995"],
                [996, "value-996"],
                [997, "value-997"],
            ]);
            expect(store.stats.pages).to.equal(1000);
        } finally {
            store.dispose();
        }
    });
});
