/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    HeadlessQueryResult,
    HeadlessResultSetData,
} from "../queryExecution/headlessQueryExecutor";
import { DbCellValue } from "../models/contracts/queryExecute";
import { QueryResult } from "./contracts";

export function toSqlToolsMcpQueryResult(queryResult: HeadlessQueryResult): QueryResult {
    if (queryResult.canceled) {
        return {
            result: "",
            errorMessage: "Query execution was cancelled.",
            isError: true,
        };
    }

    const errorMessages = queryResult.batches
        .flatMap((batch) => batch.messages)
        .filter((message) => message.isError)
        .map((message) => message.message)
        .filter((message) => message.length > 0);

    return {
        result: formatSqlToolsMcpResultText(queryResult),
        errorMessage: errorMessages.join("\n"),
        isError: queryResult.batches.some((batch) => batch.hasError) || errorMessages.length > 0,
    };
}

export function formatSqlToolsMcpResultText(queryResult: HeadlessQueryResult): string {
    let result = "";
    for (const batch of queryResult.batches) {
        for (const resultSet of batch.resultSets) {
            result += formatResultSet(resultSet);
            result += "\n";
        }
    }
    return result;
}

function formatResultSet(resultSet: HeadlessResultSetData): string {
    let result = "";
    for (const row of resultSet.rows) {
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
            const columnName = resultSet.columnInfo[columnIndex]?.columnName ?? "";
            const value = formatCellValue(row[columnIndex]);
            if (!columnName.startsWith("JSON_")) {
                result += `${columnName}: \n`;
            }
            result += `${value}\n`;
        }
    }
    return result;
}

function formatCellValue(cell: DbCellValue | undefined): string {
    if (!cell || cell.isNull) {
        return "";
    }
    return cell.displayValue ?? "";
}
