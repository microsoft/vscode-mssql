/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    formatSqlToolsMcpResultText,
    toSqlToolsMcpQueryResult,
} from "../../../src/sqlToolsMcp/sqlToolsMcpResultFormatter";
import {
    HeadlessBatchResult,
    HeadlessQueryResult,
    HeadlessResultSetData,
} from "../../../src/queryExecution/headlessQueryExecutor";
import { DbCellValue } from "../../../src/models/contracts/queryExecute";
import { IDbColumn, IResultMessage } from "../../../src/models/interfaces";

suite("SQL Tools MCP result formatter", () => {
    test("formats field headers, values, and nulls in Scriptoria shape", () => {
        const result = queryResult([
            batch([
                resultSet(
                    ["name", "description"],
                    [
                        [cell("Customers"), cell("", true)],
                        [cell("Orders"), cell("Open orders")],
                    ],
                ),
            ]),
        ]);

        expect(formatSqlToolsMcpResultText(result)).to.equal(
            "name: \nCustomers\ndescription: \n\nname: \nOrders\ndescription: \nOpen orders\n\n",
        );
    });

    test("omits field headers for JSON_ columns", () => {
        const result = queryResult([batch([resultSet(["JSON_Result"], [[cell('[{"id":1}]')]])])]);

        expect(formatSqlToolsMcpResultText(result)).to.equal('[{"id":1}]\n\n');
    });

    test("separates multiple result sets with a blank line", () => {
        const result = queryResult([
            batch([resultSet(["first"], [[cell("1")]]), resultSet(["second"], [[cell("2")]])]),
        ]);

        expect(formatSqlToolsMcpResultText(result)).to.equal("first: \n1\n\nsecond: \n2\n\n");
    });

    test("handles missing column metadata and undefined display values", () => {
        const result = queryResult([
            batch([
                {
                    columnInfo: [],
                    rows: [[{ isNull: false } as DbCellValue]],
                    rowCount: 1,
                },
            ]),
        ]);

        expect(formatSqlToolsMcpResultText(result)).to.equal(": \n\n\n");
    });

    test("returns cancellation as QueryResult error", () => {
        const result = toSqlToolsMcpQueryResult({
            batches: [],
            canceled: true,
        });

        expect(result).to.deep.equal({
            result: "",
            errorMessage: "Query execution was cancelled.",
            isError: true,
        });
    });

    test("maps batch and message errors into QueryResult", () => {
        const result = toSqlToolsMcpQueryResult(
            queryResult([
                batch([resultSet(["value"], [[cell("1")]])], true, [
                    { message: "syntax error", isError: true } as IResultMessage,
                    { message: "informational", isError: false } as IResultMessage,
                ]),
            ]),
        );

        expect(result).to.deep.equal({
            result: "value: \n1\n\n",
            errorMessage: "syntax error",
            isError: true,
        });
    });

    test("ignores empty error messages", () => {
        const result = toSqlToolsMcpQueryResult(
            queryResult([
                batch([], false, [
                    { message: "", isError: true } as IResultMessage,
                    { message: "warning", isError: false } as IResultMessage,
                ]),
            ]),
        );

        expect(result.errorMessage).to.equal("");
        expect(result.isError).to.equal(false);
    });
});

function queryResult(batches: HeadlessBatchResult[]): HeadlessQueryResult {
    return {
        batches,
        canceled: false,
    };
}

function batch(
    resultSets: HeadlessResultSetData[],
    hasError = false,
    messages: IResultMessage[] = [],
): HeadlessBatchResult {
    return {
        batchSummary: { id: 0, hasError } as HeadlessBatchResult["batchSummary"],
        messages,
        resultSets,
        hasError,
    };
}

function resultSet(columnNames: string[], rows: DbCellValue[][]): HeadlessResultSetData {
    return {
        columnInfo: columnNames.map((columnName) => ({ columnName }) as IDbColumn),
        rows,
        rowCount: rows.length,
    };
}

function cell(displayValue: string, isNull = false): DbCellValue {
    return { displayValue, isNull } as DbCellValue;
}
