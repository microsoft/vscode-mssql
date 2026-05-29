/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDbColumn, DbCellValue } from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { isJson } from "../../common/jsonUtils";
import { isXmlCell } from "../../common/xmlUtils";
import { DBCellValue, escape, hyperLinkFormatter, textFormatter } from "./table/formatters";

export const NULL_CELL_CSS_CLASS = "cell-null";

/**
 * Get the column name to be displayed in the grid header.
 * @param columnInfo The column info object.
 * @returns The column name to be displayed.
 */
export function getQueryResultColumnName(columnInfo: IDbColumn): string {
    return columnInfo.columnName === "Microsoft SQL Server 2005 XML Showplan"
        ? locConstants.queryResult.showplanXML
        : escape(columnInfo.columnName);
}

export function getQueryResultColumnFormatter(columnInfo: IDbColumn): (
    row: number | undefined,
    cell: any,
    value: DbCellValue,
    columnDef: any | undefined,
    dataContext: any | undefined,
) =>
    | string
    | {
          text: string;
          addClasses: string;
      } {
    if (columnInfo.isXml || columnInfo.isJson) {
        return hyperLinkFormatter;
    }

    // VECTOR columns display as plain text. Their [n,n,n] format looks like a JSON array
    // but must never be formatted as a JSON hyperlink or opened in the JSON viewer.
    if (columnInfo.isVector) {
        return textFormatter;
    }

    // Avoid expensive XML/JSON parsing on every cell render for plain-text columns.
    // Track which rows we've already sampled so SlickGrid re-renders don't
    // exhaust the budget.
    const sampledRows = new Set<number>();
    const maxDistinctRows = 20;

    return (
        row: number | undefined,
        cell: any | undefined,
        value: DbCellValue,
        columnDef: any | undefined,
        dataContext: any | undefined,
    ): string | { text: string; addClasses: string } => {
        if (columnInfo.isXml || columnInfo.isJson) {
            return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
        }

        const displayValue = value?.displayValue;

        // Skip detection for null/empty values or when we've already sampled this row.
        if (
            !displayValue ||
            value?.isNull ||
            row === undefined ||
            sampledRows.has(row) ||
            sampledRows.size >= maxDistinctRows
        ) {
            return textFormatter(
                row,
                cell,
                value,
                columnDef,
                dataContext,
                DBCellValue.isDBCellValue(value) && value.isNull ? NULL_CELL_CSS_CLASS : undefined,
            );
        }

        sampledRows.add(row);

        if (isXmlCell(displayValue) && columnInfo) {
            columnInfo.isXml = true;
            return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
        } else if (isJson(displayValue) && columnInfo) {
            // TODO: use showJsonAsLink config.
            columnInfo.isJson = true;
            return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
        } else {
            return textFormatter(
                row,
                cell,
                value,
                columnDef,
                dataContext,
                DBCellValue.isDBCellValue(value) && value.isNull ? NULL_CELL_CSS_CLASS : undefined,
            );
        }
    };
}
