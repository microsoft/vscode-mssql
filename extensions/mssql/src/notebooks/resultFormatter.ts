/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDbColumn, DbCellValue } from "vscode-mssql";
import * as LocalizedConstants from "../constants/locConstants";

const MAX_ROWS_DISPLAY = 500;
const MAX_COLUMN_WIDTH = 200;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function truncate(text: string, maxWidth: number): string {
    if (text.length > maxWidth) {
        return text.substring(0, maxWidth - 3) + "...";
    }
    return text;
}

function cellDisplayValue(cell: DbCellValue): string {
    return cell.isNull ? "NULL" : cell.displayValue;
}

export function toHtml(columns: IDbColumn[], rows: DbCellValue[][]): string {
    const isTruncated = rows.length > MAX_ROWS_DISPLAY;
    const displayRows = rows.slice(0, MAX_ROWS_DISPLAY);

    const tableId = `sqltbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const borderColor = "var(--vscode-panel-border, #444)";
    const headerBg = "var(--vscode-editorGroupHeader-tabsBackground, #252526)";
    const rowNumBg = "var(--vscode-editorGroupHeader-tabsBackground, #252526)";
    const rowNumColor = "var(--vscode-descriptionForeground, #858585)";
    const handleHoverColor = "var(--vscode-focusBorder, #007fd4)";
    const cellStyle = `border:1px solid ${borderColor};padding:4px 8px;`;
    const thStyle = `${cellStyle}background:${headerBg};text-align:left;font-weight:600;position:relative;`;
    const handleStyle =
        "position:absolute;top:0;right:-3px;width:5px;height:100%;cursor:col-resize;z-index:1;";

    const headerCells =
        `<th style="${cellStyle}background:${headerBg};width:30px;min-width:30px;"></th>` +
        columns
            .map(
                (col) =>
                    `<th style="${thStyle}min-width:100px;white-space:nowrap;"><span>${escapeHtml(col.columnName)}</span><div class="${tableId}-handle" style="${handleStyle}"></div></th>`,
            )
            .join("");

    const bodyRows = displayRows
        .map((row, rowIdx) => {
            const rowNum = `<td style="${cellStyle}background:${rowNumBg};color:${rowNumColor};text-align:right;user-select:none;">${rowIdx + 1}</td>`;
            const cells = row
                .map((cell) => {
                    const val = truncate(escapeHtml(cellDisplayValue(cell)), MAX_COLUMN_WIDTH);
                    return `<td style="${cellStyle}text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${val}</td>`;
                })
                .join("");
            return `<tr>${rowNum}${cells}</tr>`;
        })
        .join("\n");

    let countMsg = LocalizedConstants.Notebooks.rowCountPlain(rows.length);
    if (isTruncated) {
        countMsg += ` (showing first ${MAX_ROWS_DISPLAY})`;
    }

    const resizeScript = `
<script>
(function(){
  var table = document.getElementById('${tableId}');
  if (!table) return;
  var handles = table.querySelectorAll('.${tableId}-handle');
  handles.forEach(function(handle) {
    handle.addEventListener('mouseenter', function() { handle.style.background = '${handleHoverColor}'; });
    handle.addEventListener('mouseleave', function() { if (!handle.dataset.dragging) handle.style.background = 'transparent'; });
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var th = handle.parentElement;
      var startX = e.clientX;
      var startW = th.offsetWidth;
      handle.dataset.dragging = '1';
      handle.style.background = '${handleHoverColor}';
      function onMove(ev) {
        var newW = Math.max(40, startW + (ev.clientX - startX));
        th.style.width = newW + 'px';
      }
      function onUp() {
        delete handle.dataset.dragging;
        handle.style.background = 'transparent';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();
</script>`;

    return [
        '<div style="max-height:300px;overflow:auto;">',
        `<table id="${tableId}" style="border-collapse:collapse;border:1px solid ${borderColor};font-size:12px;font-family:var(--vscode-editor-font-family, monospace);">`,
        `<thead style="position:sticky;top:0;"><tr>${headerCells}</tr></thead>`,
        `<tbody>${bodyRows}</tbody>`,
        "</table>",
        "</div>",
        `<p><em>${countMsg}</em></p>`,
        resizeScript,
    ].join("\n");
}

export function toPlain(columns: IDbColumn[], rows: DbCellValue[][]): string {
    if (rows.length === 0) {
        return LocalizedConstants.Notebooks.zeroRows;
    }

    const displayRows = rows.slice(0, MAX_ROWS_DISPLAY);
    const colNames = columns.map((c) => c.columnName);
    const widths = colNames.map((c) => c.length);

    for (const row of displayRows) {
        for (let i = 0; i < row.length; i++) {
            const val = cellDisplayValue(row[i]);
            widths[i] = Math.min(Math.max(widths[i] || 0, val.length), MAX_COLUMN_WIDTH);
        }
    }

    const header = colNames.map((c, i) => c.padEnd(widths[i])).join(" | ");
    const separator = widths.map((w) => "-".repeat(w)).join("-+-");

    const lines = [header, separator];
    for (const row of displayRows) {
        const line = row.map((cell, i) => cellDisplayValue(cell).padEnd(widths[i])).join(" | ");
        lines.push(line);
    }
    lines.push(LocalizedConstants.Notebooks.rowCountPlain(rows.length));
    return lines.join("\n");
}
