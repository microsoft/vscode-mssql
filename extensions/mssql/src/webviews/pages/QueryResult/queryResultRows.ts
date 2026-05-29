/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DbCellValue } from "../../../sharedInterfaces/queryResult";
import { SLICKGRID_ROW_ID_PROP } from "./table/utils";

export const QUERY_RESULT_ROW_NUMBER_FIELD = "_mssqlRowNumber";

export interface QueryResultGridCellValue extends DbCellValue {
    ariaLabel: string;
    invariantCultureDisplayValue: string;
}

export interface QueryResultGridRow extends Slick.SlickData {
    id: number;
    [QUERY_RESULT_ROW_NUMBER_FIELD]: string;
    [SLICKGRID_ROW_ID_PROP]: number;
    [key: string]: QueryResultGridCellValue | number | string;
}

export function createQueryResultGridRow(
    cells: DbCellValue[],
    absoluteRowIndex: number,
    columnCount: number,
): QueryResultGridRow {
    const row: QueryResultGridRow = {
        id: absoluteRowIndex,
        [QUERY_RESULT_ROW_NUMBER_FIELD]: (absoluteRowIndex + 1).toString(),
        [SLICKGRID_ROW_ID_PROP]: absoluteRowIndex,
    };

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const cell = cells[columnIndex];
        const displayValue = cell?.isNull ? "NULL" : (cell?.displayValue ?? "");
        row[columnIndex.toString()] = {
            displayValue,
            ariaLabel: displayValue,
            isNull: cell?.isNull ?? false,
            invariantCultureDisplayValue: displayValue,
            rowId: absoluteRowIndex,
        };
    }

    return row;
}

export function createQueryResultPlaceholderRow(
    absoluteRowIndex: number,
    columnCount: number,
): QueryResultGridRow {
    return createQueryResultGridRow([], absoluteRowIndex, columnCount);
}
