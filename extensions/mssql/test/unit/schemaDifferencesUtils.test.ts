/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getSchemaDifferenceNavigationTarget } from "../../src/webviews/pages/SchemaCompare/components/schemaDifferencesUtils";

suite("SchemaDifferences keyboard navigation", () => {
    const rows = ["group", "diff", "diff", "group", "diff"] as const;

    test("ArrowUp and ArrowDown move through rendered rows", () => {
        expect(getSchemaDifferenceNavigationTarget(rows, 2, "ArrowUp")).to.equal(1);
        expect(getSchemaDifferenceNavigationTarget(rows, 2, "ArrowDown")).to.equal(3);
    });

    test("ArrowUp and ArrowDown stop at the list boundaries", () => {
        expect(getSchemaDifferenceNavigationTarget(rows, 0, "ArrowUp")).to.equal(0);
        expect(getSchemaDifferenceNavigationTarget(rows, rows.length - 1, "ArrowDown")).to.equal(
            rows.length - 1,
        );
    });

    test("Home and End select the first and last visible differences", () => {
        expect(getSchemaDifferenceNavigationTarget(rows, 3, "Home")).to.equal(1);
        expect(getSchemaDifferenceNavigationTarget(rows, 1, "End")).to.equal(4);
    });

    test("Home and End return no target when only group rows are visible", () => {
        const groupRows = ["group", "group"] as const;
        expect(getSchemaDifferenceNavigationTarget(groupRows, 0, "Home")).to.be.undefined;
        expect(getSchemaDifferenceNavigationTarget(groupRows, 1, "End")).to.be.undefined;
    });

    test("returns no target for an invalid current row", () => {
        expect(getSchemaDifferenceNavigationTarget(rows, -1, "ArrowDown")).to.be.undefined;
        expect(getSchemaDifferenceNavigationTarget([], 0, "Home")).to.be.undefined;
    });
});
