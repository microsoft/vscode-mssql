/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Column } from "slickgrid-react";
import type { IDbColumn } from "../../../../sharedInterfaces/queryResult";
import {
    FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
} from "./fluentResultGridConstants";
import {
    fluentResultGridRowNumberFormatter,
    getFluentResultGridColumnFormatter,
    getFluentResultGridColumnName,
} from "./fluentResultGridFormatters";
import {
    FLUENT_RESULT_GRID_ROW_NUMBER_FIELD,
    type FluentResultGridDataRow,
} from "./fluentResultGridDataView";

export function isFluentResultGridDataColumn(column: Column<FluentResultGridDataRow>): boolean {
    return column.id !== FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID && !column.excludeFromGridMenu;
}

export function getFluentResultGridColumnId(columnIndex: number): string {
    return columnIndex.toString();
}

export function getFluentResultGridColumnIndexFromColumn(
    column: Column<FluentResultGridDataRow>,
): number | undefined {
    const columnIndex = Number(column.field);
    return Number.isInteger(columnIndex) ? columnIndex : undefined;
}

export function createFluentResultGridColumns({
    columnInfo,
    enableColumnReorder = true,
    showRowNumberColumn = true,
}: {
    columnInfo: IDbColumn[];
    enableColumnReorder?: boolean;
    showRowNumberColumn?: boolean;
}): Column<FluentResultGridDataRow>[] {
    const columns: Column<FluentResultGridDataRow>[] = columnInfo.map((column, index) => ({
        id: getFluentResultGridColumnId(index),
        name: getFluentResultGridColumnName(column),
        toolTip: column.columnName,
        field: index.toString(),
        width: FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
        minWidth: 50,
        reorderable: enableColumnReorder,
        sortable: false,
        filterable: true,
        formatter: getFluentResultGridColumnFormatter(column),
    }));

    if (!showRowNumberColumn) {
        return columns;
    }

    return [
        {
            id: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
            name: "",
            field: FLUENT_RESULT_GRID_ROW_NUMBER_FIELD,
            width: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
            minWidth: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
            maxWidth: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
            cssClass: "fluent-result-grid-row-number-cell",
            headerCssClass: "fluent-result-grid-row-number-header",
            reorderable: false,
            resizable: false,
            selectable: false,
            sortable: false,
            excludeFromColumnPicker: true,
            excludeFromGridMenu: true,
            excludeFromHeaderMenu: true,
            formatter: fluentResultGridRowNumberFormatter,
        },
        ...columns,
    ];
}

export function areAllFluentResultGridColumnsShown(
    columns: Column<FluentResultGridDataRow>[],
): boolean {
    const gridMenuColumns = columns.filter(isFluentResultGridDataColumn);
    return gridMenuColumns.length === 0 || gridMenuColumns.every((column) => !column.hidden);
}
