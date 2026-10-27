/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { executeParamsForSelection } from "../../src/webviews/pages/QueryStudio/executionRequests";

suite("Query Studio execution requests", () => {
    test("uses document scope when there is no selection", () => {
        expect(executeParamsForSelection(undefined)).to.deep.equal({ scope: "document" });
        expect(executeParamsForSelection(null)).to.deep.equal({ scope: "document" });
    });

    test("uses document scope for an empty Monaco selection", () => {
        expect(
            executeParamsForSelection({
                startLineNumber: 4,
                startColumn: 7,
                endLineNumber: 4,
                endColumn: 7,
                isEmpty: () => true,
            }),
        ).to.deep.equal({ scope: "document" });
    });

    test("uses selection scope for non-empty selections", () => {
        expect(
            executeParamsForSelection({
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 5,
                endColumn: 9,
                isEmpty: () => false,
            }),
        ).to.deep.equal({
            scope: "selection",
            selection: {
                startLine: 2,
                startColumn: 3,
                endLine: 5,
                endColumn: 9,
            },
        });
    });
});
