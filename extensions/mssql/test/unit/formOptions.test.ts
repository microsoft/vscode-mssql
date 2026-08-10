/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    findFirstFavoriteOption,
    findOptionIndex,
    sortOptionsWithFavorites,
} from "../../src/utils/formOptions";

suite("Form option favorites", () => {
    test("sorts favorites first while preserving order within each group", () => {
        const options = [
            { value: "one" },
            { value: "two", favoriteId: "scope/two" },
            { value: "three" },
            { value: "four", favoriteId: "scope/four" },
        ];

        const sorted = sortOptionsWithFavorites(options, ["scope/four", "scope/two"]);

        expect(sorted.map((option) => option.value)).to.deep.equal(["two", "four", "one", "three"]);
    });

    test("does not alter dropdowns that do not enable favorites", () => {
        const options = [{ value: "one" }, { value: "two" }];

        const sorted = sortOptionsWithFavorites(options);

        expect(sorted).to.equal(options);
        expect(sorted).to.deep.equal([{ value: "one" }, { value: "two" }]);
    });

    test("returns the caller-provided index after favorite sorting", () => {
        const options = [{ value: "one" }, { value: "two" }, { value: "three" }];
        const sorted = sortOptionsWithFavorites(options, ["two"]);

        expect(sorted[0].value).to.equal("two");
        expect(findOptionIndex(options, sorted[0])).to.equal(1);
    });

    test("finds the first favorite in the provided option order", () => {
        const options = [
            { value: "one" },
            { value: "two", favoriteId: "scope/two" },
            { value: "three" },
        ];

        expect(findFirstFavoriteOption(options, ["three", "scope/two"])?.value).to.equal("two");
        expect(findFirstFavoriteOption(options)?.value).to.be.undefined;
    });
});
