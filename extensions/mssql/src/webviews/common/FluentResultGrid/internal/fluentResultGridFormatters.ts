/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Formatter } from "@slickgrid-universal/common";
import { isJson } from "../../jsonUtils";
import { isXmlCell } from "../../xmlUtils";
import type { IDbColumn } from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";

export const FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS = "cell-null";

function isDbCellValue(value: unknown): value is { displayValue: string; isNull: boolean } {
    return (
        typeof value === "object" && value !== null && "displayValue" in value && "isNull" in value
    );
}

export function escapeHtml(value: string): string {
    return value.replace(/[<|>|&|"|']/g, (match) => {
        switch (match) {
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "&":
                return "&amp;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return match;
        }
    });
}

function getCellDisplayValue(cellValue: string): string {
    const valueToDisplay = cellValue.length > 250 ? `${cellValue.slice(0, 250)}...` : cellValue;
    return escapeHtml(valueToDisplay.replace(/(\r\n|\n|\r)/g, "↵"));
}

function getTextCellHtml(
    value: unknown,
    addClasses?: string,
): string | { text: string; addClasses: string } {
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

    const html = `<span title="${titleValue}" class="${cellClasses}">${valueToDisplay}</span>`;
    return addClasses ? { text: html, addClasses } : html;
}

function getHyperlinkCellHtml(value: unknown): string {
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

    return isHyperlink
        ? `<a class="${cellClasses}" title="${valueToDisplay}">${valueToDisplay}</a>`
        : `<span title="${valueToDisplay}" class="${cellClasses}">${valueToDisplay}</span>`;
}

export function getFluentResultGridColumnName(columnInfo: IDbColumn): string {
    return columnInfo.columnName === "Microsoft SQL Server 2005 XML Showplan"
        ? "Showplan XML"
        : escapeHtml(columnInfo.columnName);
}

export function getFluentResultGridColumnFormatter(
    columnInfo: IDbColumn,
): Formatter<FluentResultGridDataRow> {
    if (columnInfo.isXml || columnInfo.isJson) {
        return ((_row, _cell, value) =>
            getHyperlinkCellHtml(value)) as Formatter<FluentResultGridDataRow>;
    }

    if (columnInfo.isVector) {
        return ((_row, _cell, value) =>
            getTextCellHtml(
                value,
                isDbCellValue(value) && value.isNull
                    ? FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS
                    : undefined,
            )) as Formatter<FluentResultGridDataRow>;
    }

    const sampledRows = new Set<number>();
    const maxDistinctRows = 20;

    return ((row, _cell, value) => {
        if (columnInfo.isXml || columnInfo.isJson) {
            return getHyperlinkCellHtml(value);
        }

        const displayValue = isDbCellValue(value) ? value.displayValue : undefined;
        if (
            !displayValue ||
            (isDbCellValue(value) && value.isNull) ||
            row === undefined ||
            sampledRows.has(row) ||
            sampledRows.size >= maxDistinctRows
        ) {
            return getTextCellHtml(
                value,
                isDbCellValue(value) && value.isNull
                    ? FLUENT_RESULT_GRID_NULL_CELL_CSS_CLASS
                    : undefined,
            );
        }

        sampledRows.add(row);

        if (isXmlCell(displayValue)) {
            columnInfo.isXml = true;
            return getHyperlinkCellHtml(value);
        }

        if (isJson(displayValue)) {
            columnInfo.isJson = true;
            return getHyperlinkCellHtml(value);
        }

        return getTextCellHtml(value);
    }) as Formatter<FluentResultGridDataRow>;
}

export function fluentResultGridRowNumberFormatter(
    _row: number | undefined,
    _cell: number | undefined,
    value: unknown,
): string {
    return `<span class="row-number fluent-result-grid-row-number">${value ?? ""}</span>`;
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
