/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DBCellValue {
    displayValue: string;
    isNull: boolean;
}

export namespace DBCellValue {
    export function isDBCellValue(object: any): boolean {
        return (
            object !== undefined && object.displayValue !== undefined && object.isNull !== undefined
        );
    }
}

/**
 * Format all text to replace all new lines with spaces and performs HTML entity encoding
 */
export function textFormatter(
    _row: number | undefined,
    _cell: any | undefined,
    value: any,
    _columnDef: any | undefined,
    _dataContext: any | undefined,
    addClasses?: string,
): string | { text: string; addClasses: string } {
    let cellClasses = "grid-cell-value-container";
    let valueToDisplay = "";
    let titleValue = "";
    let cellStyle = "";
    if (DBCellValue.isDBCellValue(value)) {
        valueToDisplay = "NULL";
        if (!value.isNull) {
            valueToDisplay = getCellDisplayValue(value.displayValue);
            titleValue = valueToDisplay;
        } else {
            cellClasses += " missing-value";
        }
    } else if (typeof value === "string" || (value && value.text)) {
        if (value.text) {
            valueToDisplay = value.text;
            if (value.style) {
                cellStyle = value.style;
            }
        } else {
            valueToDisplay = value;
        }
        valueToDisplay = getCellDisplayValue(valueToDisplay);
        titleValue = valueToDisplay;
    } else if (value && value.title) {
        if (value.title) {
            valueToDisplay = value.title;

            if (value.style) {
                cellStyle = value.style;
            }
        }
        valueToDisplay = getCellDisplayValue(valueToDisplay);
        titleValue = valueToDisplay;
    }

    const formattedValue = `<span title="${titleValue}" style="${cellStyle}" class="${cellClasses}">${valueToDisplay}</span>`;

    if (addClasses) {
        return { text: formattedValue, addClasses: addClasses };
    }

    return formattedValue;
}

export function getCellDisplayValue(cellValue: string): string {
    let valueToDisplay = cellValue.length > 250 ? cellValue.slice(0, 250) + "..." : cellValue;
    // allow-any-unicode-next-line
    valueToDisplay = valueToDisplay.replace(/(\r\n|\n|\r)/g, "↵");
    return escape(valueToDisplay);
}

/**
 * Converts HTML characters inside the string to use entities instead. Makes the string safe from
 * being used e.g. in HTMLElement.innerHTML.
 */
export function escape(html: string): string {
    return html.replace(/[<|>|&|"|\']/g, function (match) {
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
