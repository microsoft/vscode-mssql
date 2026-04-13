/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as qr from "../../src/sharedInterfaces/queryResult";
import {
    getDisplayedRowsCount,
    getTotalResultSetRowCount,
} from "../../src/webviews/pages/QueryResult/queryResultUtils";

suite("QueryResultSummaryFooter row count", () => {
    const summaries: Record<number, Record<number, qr.ResultSetSummary>> = {
        0: {
            0: {
                id: 0,
                batchId: 0,
                rowCount: 10,
                columnInfo: [],
            },
            1: {
                id: 1,
                batchId: 0,
                rowCount: 25,
                columnInfo: [],
            },
        },
        1: {
            0: {
                id: 0,
                batchId: 1,
                rowCount: 7,
                columnInfo: [],
            },
        },
    };

    test("returns total rows across all grids when no grid is selected", () => {
        const result = getDisplayedRowsCount(summaries, undefined, []);

        expect(result).to.equal(42);
    });

    test("returns the selected grid row count when a grid selection is active", () => {
        const selectionSummary: qr.SelectionSummary = {
            batchId: 0,
            resultId: 1,
        };

        const result = getDisplayedRowsCount(summaries, selectionSummary, []);

        expect(result).to.equal(25);
    });

    test("falls back to the latest rows affected message when no grid summaries exist", () => {
        const messages: qr.IMessage[] = [
            { message: "(3 rows affected)", isError: false },
            { message: "(5 rows affected)", isError: false },
        ];

        const result = getDisplayedRowsCount({}, undefined, messages);

        expect(result).to.equal(5);
    });

    test("sums row counts only when result sets have row counts", () => {
        expect(getTotalResultSetRowCount({})).to.equal(undefined);
    });
});
