/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DBCellValue {
  displayValue: string;
  isNull: boolean;
}

/**
 * Info for executing a command. @see azdata.ExecuteCommandInfo
 */
export interface ExecuteCommandInfo {
  id: string;
  displayText?: string;
  args?: string[];
}

/**
 * The info for a DataGrid Text Cell.
 */
export interface TextCellValue {
  text: string;
  ariaLabel: string;
}

/**
 * The info for a DataGrid Hyperlink Cell.
 */
export interface HyperlinkCellValue {
  displayText: string;
  linkOrCommand: string | ExecuteCommandInfo;
}

export interface CssIconCellValue {
  iconCssClass: string;
  title: string;
}

export namespace DBCellValue {
  export function isDBCellValue(object: any): boolean {
    return (
      object !== undefined &&
      object.displayValue !== undefined &&
      object.isNull !== undefined
    );
  }
}

/**
 * Checks whether the specified object is a HyperlinkCellValue object or not
 * @param obj The object to test
 */
export function isHyperlinkCellValue(
  obj: any | undefined,
): obj is HyperlinkCellValue {
  return !!(<HyperlinkCellValue>obj)?.linkOrCommand;
}

export function isCssIconCellValue(
  obj: any | undefined,
): obj is CssIconCellValue {
  return !!(<CssIconCellValue>obj)?.iconCssClass;
}

/**
 * Format xml field into a hyperlink and performs HTML entity encoding
 */
export function hyperLinkFormatter(
  _row: number | undefined,
  _cell: any | undefined,
  value: any,
  _columnDef: any | undefined,
  _dataContext: any | undefined,
): string {
  let cellClasses = "grid-cell-value-container";
  let valueToDisplay = "";
  let isHyperlink = false;
  if (DBCellValue.isDBCellValue(value)) {
    valueToDisplay = "NULL";
    if (!value.isNull) {
      valueToDisplay = getCellDisplayValue(value.displayValue);
      isHyperlink = true;
    } else {
      cellClasses += " missing-value";
    }
  } else if (isHyperlinkCellValue(value)) {
    valueToDisplay = getCellDisplayValue(value.displayText);
    isHyperlink = true;
  }

  if (isHyperlink) {
    return `<a class="${cellClasses}" title="${valueToDisplay}">${valueToDisplay}</a>`;
  } else {
    return `<span title="${valueToDisplay}" class="${cellClasses}">${valueToDisplay}</span>`;
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
  let valueToDisplay =
    cellValue.length > 250 ? cellValue.slice(0, 250) + "..." : cellValue;
  // allow-any-unicode-next-line
  valueToDisplay = valueToDisplay.replace(/(\r\n|\n|\r)/g, "↵");
  return escape(valueToDisplay);
}

export function iconCssFormatter(
  row: number | undefined,
  cell: any | undefined,
  value: any,
  columnDef: any | undefined,
  dataContext: any | undefined,
): string | { text: string; addClasses: string } {
  if (isCssIconCellValue(value)) {
    return `<div role="image" title="${escape(value.title ?? "")}" aria-label="${escape(value.title ?? "")}" class="grid-cell-value-container icon codicon slick-icon-cell-content ${value.iconCssClass}"></div>`;
  }
  return textFormatter(row, cell, value, columnDef, dataContext);
}

export function imageFormatter(
  _row: number | undefined,
  _cell: any | undefined,
  value: any,
  _columnDef: any | undefined,
  _dataContext: any | undefined,
): string {
  return `<img src="${value.text}" />`;
}

/**
 * Extracts the specified field into the expected object to be handled by SlickGrid and/or formatters as needed.
 */
export function slickGridDataItemColumnValueExtractor(
  value: any,
  columnDef: any,
): TextCellValue | HyperlinkCellValue {
  let fieldValue = value[columnDef.field];
  if (columnDef.type === "hyperlink") {
    return <HyperlinkCellValue>{
      displayText: fieldValue.displayText,
      linkOrCommand: fieldValue.linkOrCommand,
    };
  } else {
    return <TextCellValue>{
      text: fieldValue,
      ariaLabel: fieldValue ? escape(fieldValue) : fieldValue,
    };
  }
}

/**
 * Alternate function to provide slick grid cell with ariaLabel and plain text
 * In this case, for no display value ariaLabel will be set to specific string "no data available" for accessibily support for screen readers
 * Set 'no data' label only if cell is present and has no value (so that checkbox and other custom plugins do not get 'no data' label)
 */
export function slickGridDataItemColumnValueWithNoData(
  value: any,
  columnDef: any,
): { text: string; ariaLabel: string } | CssIconCellValue {
  let displayValue = value[columnDef.field];
  if (typeof displayValue === "number") {
    displayValue = displayValue.toString();
  }
  if (displayValue instanceof Array) {
    displayValue = displayValue.toString();
  }

  if (isCssIconCellValue(displayValue)) {
    return displayValue;
  }

  return {
    text: displayValue,
    ariaLabel: displayValue
      ? escape(displayValue)
      : displayValue !== undefined
        ? "TODO loc No Value"
        : displayValue,
  };
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

/** The following code is a rewrite over the both formatter function using dom builder
 * rather than string manipulation, which is a safer and easier method of achieving the same goal.
 * However, when electron is in "Run as node" mode, dom creation acts differently than normal and therefore
 * the tests to test for html escaping fail. I'm keeping this code around as we should migrate to it if we ever
 * integrate into actual DOM testing (electron running in normal mode) later on.

export const hyperLinkFormatter: Slick.Formatter<any> = (row, cell, value, columnDef, dataContext): string => {
	let classes: Array<string> = ['grid-cell-value-container'];
	let displayValue = '';

	if (DBCellValue.isDBCellValue(value)) {
		if (!value.isNull) {
			displayValue = value.displayValue;
			classes.push('queryLink');
			let linkContainer = $('a', {
				class: classes.join(' '),
				title: displayValue
			});
			linkContainer.innerText = displayValue;
			return linkContainer.outerHTML;
		} else {
			classes.push('missing-value');
		}
	}

	let cellContainer = $('span', { class: classes.join(' '), title: displayValue });
	cellContainer.innerText = displayValue;
	return cellContainer.outerHTML;
};

export const textFormatter: Slick.Formatter<any> = (row, cell, value, columnDef, dataContext): string => {
	let displayValue = '';
	let classes: Array<string> = ['grid-cell-value-container'];

	if (DBCellValue.isDBCellValue(value)) {
		if (!value.isNull) {
			displayValue = value.displayValue.replace(/(\r\n|\n|\r)/g, ' ');
		} else {
			classes.push('missing-value');
			displayValue = 'NULL';
		}
	}

	let cellContainer = $('span', { class: classes.join(' '), title: displayValue });
	cellContainer.innerText = displayValue;

	return cellContainer.outerHTML;
};

*/
