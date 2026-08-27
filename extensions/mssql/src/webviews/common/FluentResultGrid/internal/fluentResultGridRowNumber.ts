/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Column, FormatterResultWithHtml } from "slickgrid-react";
import {
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
} from "./fluentResultGridConstants";
import {
    FLUENT_RESULT_GRID_ROW_NUMBER_FIELD,
    type FluentResultGridDataRow,
} from "./fluentResultGridDataView";

export interface FluentResultGridRowNumberContent {
    textContent: string;
    title: string;
}

export function getFluentResultGridRowNumberContent(
    value: unknown,
): FluentResultGridRowNumberContent {
    const displayValue = value?.toString() ?? "";
    return {
        textContent: displayValue,
        title: displayValue,
    };
}

export function fluentResultGridRowNumberFormatter(
    _row: number | undefined,
    _cell: number | undefined,
    value: unknown,
): FormatterResultWithHtml {
    const rowNumber = document.createElement("span");
    const content = getFluentResultGridRowNumberContent(value);
    rowNumber.className = "row-number fluent-result-grid-row-number";
    rowNumber.textContent = content.textContent;
    rowNumber.title = content.title;
    return { html: rowNumber };
}

export function createFluentResultGridRowNumberColumn(): Column<FluentResultGridDataRow> {
    return {
        id: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
        name: "",
        field: FLUENT_RESULT_GRID_ROW_NUMBER_FIELD,
        width: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
        minWidth: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
        cssClass: "fluent-result-grid-row-number-cell",
        headerCssClass: "fluent-result-grid-row-number-header",
        reorderable: false,
        resizable: true,
        selectable: false,
        sortable: false,
        excludeFromColumnPicker: true,
        excludeFromGridMenu: true,
        excludeFromHeaderMenu: true,
        formatter: fluentResultGridRowNumberFormatter,
    };
}
