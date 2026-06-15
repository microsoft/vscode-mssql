/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Formatter, type FormatterResultWithHtml, htmlEncode } from "slickgrid-react";
import { isJson } from "../../jsonUtils";
import { locConstants } from "../../locConstants";
import { isXmlCell } from "../../xmlUtils";
import type { IDbColumn } from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";

export const FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS = "cell-null";

function isDbCellValue(value: unknown): value is { displayValue: string; isNull: boolean } {
    return (
        typeof value === "object" && value !== null && "displayValue" in value && "isNull" in value
    );
}

function getCellDisplayValue(cellValue: string): string {
    const valueToDisplay = cellValue.length > 250 ? `${cellValue.slice(0, 250)}...` : cellValue;
    return valueToDisplay.replace(/(\r\n|\n|\r)/g, "↵");
}

function createCellValueElement({
    tagName,
    valueToDisplay,
    titleValue = valueToDisplay,
    cellClasses,
}: {
    tagName: "a" | "span";
    valueToDisplay: string;
    titleValue?: string;
    cellClasses: string;
}): HTMLElement {
    const element = document.createElement(tagName);
    element.className = cellClasses;
    element.title = titleValue;
    element.textContent = valueToDisplay;
    return element;
}

function getTextCellFormatterResult(value: unknown, addClasses?: string): FormatterResultWithHtml {
    let cellClasses = "grid-cell-value-container";
    let valueToDisplay = "";
    let titleValue = "";

    if (isDbCellValue(value)) {
        valueToDisplay = "NULL";
        if (!value.isNull) {
            valueToDisplay = getCellDisplayValue(value.displayValue);
            titleValue = valueToDisplay;
        } else {
            cellClasses += " missing-value";
        }
    } else if (typeof value === "string") {
        valueToDisplay = getCellDisplayValue(value);
        titleValue = valueToDisplay;
    }

    return {
        html: createCellValueElement({
            tagName: "span",
            valueToDisplay,
            titleValue,
            cellClasses,
        }),
        addClasses,
    };
}

function getHyperlinkCellFormatterResult(value: unknown): FormatterResultWithHtml {
    let cellClasses = "grid-cell-value-container";
    let valueToDisplay = "";
    let isHyperlink = false;

    if (isDbCellValue(value)) {
        valueToDisplay = "NULL";
        if (!value.isNull) {
            valueToDisplay = getCellDisplayValue(value.displayValue);
            isHyperlink = true;
        } else {
            cellClasses += " missing-value";
        }
    }

    return {
        html: createCellValueElement({
            tagName: isHyperlink ? "a" : "span",
            valueToDisplay,
            cellClasses,
        }),
    };
}

export function getFluentResultGridColumnName(columnInfo: IDbColumn): string {
    return columnInfo.columnName === "Microsoft SQL Server 2005 XML Showplan"
        ? htmlEncode(locConstants.queryResult.showplanXML)
        : htmlEncode(columnInfo.columnName);
}

export function getFluentResultGridColumnFormatter(
    columnInfo: IDbColumn,
): Formatter<FluentResultGridDataRow> {
    let shouldRenderAsHyperlink = columnInfo.isXml || columnInfo.isJson;

    if (columnInfo.isVector && !shouldRenderAsHyperlink) {
        return ((_row, _cell, value) =>
            getTextCellFormatterResult(
                value,
                isDbCellValue(value) && value.isNull
                    ? FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS
                    : undefined,
            )) as Formatter<FluentResultGridDataRow>;
    }

    const sampledRows = new Set<number>();
    const maxDistinctRows = 20;

    return ((row, _cell, value) => {
        if (shouldRenderAsHyperlink) {
            return getHyperlinkCellFormatterResult(value);
        }

        const displayValue = isDbCellValue(value) ? value.displayValue : undefined;
        if (
            !displayValue ||
            (isDbCellValue(value) && value.isNull) ||
            row === undefined ||
            sampledRows.has(row) ||
            sampledRows.size >= maxDistinctRows
        ) {
            return getTextCellFormatterResult(
                value,
                isDbCellValue(value) && value.isNull
                    ? FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS
                    : undefined,
            );
        }

        sampledRows.add(row);

        if (isXmlCell(displayValue) || isJson(displayValue)) {
            shouldRenderAsHyperlink = true;
            return getHyperlinkCellFormatterResult(value);
        }

        return getTextCellFormatterResult(value);
    }) as Formatter<FluentResultGridDataRow>;
}

export function fluentResultGridRowNumberFormatter(
    _row: number | undefined,
    _cell: number | undefined,
    value: unknown,
): FormatterResultWithHtml {
    const rowNumber = document.createElement("span");
    rowNumber.className = "row-number fluent-result-grid-row-number";
    rowNumber.textContent = value?.toString() ?? "";
    return { html: rowNumber };
}

export function getFluentResultGridAutoSizeCellText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (isDbCellValue(value)) {
        return value.isNull ? "NULL" : (value.displayValue ?? "");
    }

    return "";
}
