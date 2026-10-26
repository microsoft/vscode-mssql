/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { QsResultSetSummary, QsCellWindow } from "../../src/sharedInterfaces/queryStudio";
import {
    buildTextViewContent,
    textViewContentInput,
} from "../../src/webviews/pages/QueryStudio/resultsTextContent";
import { Rpc } from "../../src/webviews/pages/QueryStudio/resultsGridShared";

suite("Query Studio text result materialization", () => {
    const summary: QsResultSetSummary = {
        resultSetId: "b0r0s0",
        batchOrdinal: 0,
        columnNames: ["value"],
        rowCount: 10_000,
        complete: false,
    };

    test("streaming row notifications do not invalidate completed text or fetch incomplete prefixes", () => {
        const completed = { ...summary, resultSetId: "completed", complete: true, rowCount: 1 };
        const key = textViewContentInput([completed, summary], "\n", undefined);
        for (let rowCount = 1; rowCount <= 100_000; rowCount += 1000) {
            expect(
                textViewContentInput([{ ...completed }, { ...summary, rowCount }], "\n", undefined),
            ).to.equal(key);
        }
        expect(JSON.parse(key).resultSets).to.deep.equal([completed]);
        expect(
            textViewContentInput([completed, { ...summary, complete: true }], "\n", undefined),
        ).not.to.equal(key);
    });

    test("canceling a superseded text build stops subsequent window requests", async () => {
        let canceled = false;
        let calls = 0;
        const rpc = {
            sendRequest: async () => {
                calls++;
                canceled = true;
                return {
                    resultSetId: summary.resultSetId,
                    start: 0,
                    rowCount: 5000,
                    columns: [{ name: "value" }],
                    values: Array.from({ length: 5000 }, () => ["row"]),
                } as QsCellWindow;
            },
        } as Rpc;
        await buildTextViewContent(
            rpc,
            [{ ...summary, complete: true }],
            {},
            "\n",
            undefined,
            () => canceled,
        );
        expect(calls).to.equal(1);
    });
});
