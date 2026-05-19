/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import JSZip = require("jszip");
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import type { DbCellValue, IDbColumn } from "../sharedInterfaces/queryResult";

/**
 * Minimal OOXML (.xlsx) writer for notebook result sets.
 *
 * The standard query results grid serializes Excel on STS — but notebook
 * results are kept only in the cell output (STS state is disposed after
 * execution), so we generate the workbook here in the extension. We write
 * the smallest viable xlsx: one worksheet with inline-string and numeric
 * cells; no shared strings, styles, or theme.
 *
 * Spec: ECMA-376 Office Open XML. Files inside the zip:
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/worksheets/sheet1.xml
 */
export async function buildXlsx(columnInfo: IDbColumn[], rows: DbCellValue[][]): Promise<Buffer> {
    const includeHeaders = getIncludeHeadersSetting();
    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypesXml());
    zip.file("_rels/.rels", rootRelsXml());
    zip.file("xl/workbook.xml", workbookXml());
    zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml());
    zip.file("xl/worksheets/sheet1.xml", sheetXml(columnInfo, rows, includeHeaders));
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function getIncludeHeadersSetting(): boolean {
    const config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName);
    const saveConfig = config.get(Constants.configSaveAsCsv) as any;
    return saveConfig?.includeHeaders !== false;
}

function contentTypesXml(): string {
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`
    );
}

function rootRelsXml(): string {
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    );
}

function workbookXml(): string {
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`
    );
}

function workbookRelsXml(): string {
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`
    );
}

function sheetXml(columnInfo: IDbColumn[], rows: DbCellValue[][], includeHeaders: boolean): string {
    const parts: string[] = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
    parts.push(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`);
    parts.push(`<sheetData>`);

    let currentRow = 1;

    // Header row if configured
    if (includeHeaders) {
        parts.push(`<row r="${currentRow}">`);
        for (let c = 0; c < columnInfo.length; c++) {
            parts.push(inlineStringCell(cellRef(c, currentRow), columnInfo[c].columnName));
        }
        parts.push(`</row>`);
        currentRow++;
    }

    // Data rows
    for (let r = 0; r < rows.length; r++) {
        const rowIndex = currentRow + r;
        const row = rows[r];
        parts.push(`<row r="${rowIndex}">`);
        for (let c = 0; c < columnInfo.length; c++) {
            const cell = row[c];
            if (!cell || cell.isNull) {
                continue; // omit empty cells; Excel reads missing cells as blank
            }
            const ref = cellRef(c, rowIndex);
            const col = columnInfo[c];
            if (isNumericType(col) && isFiniteNumber(cell.displayValue)) {
                parts.push(`<c r="${ref}"><v>${cell.displayValue}</v></c>`);
            } else if (isBooleanType(col)) {
                const normalizedDisplayValue = cell.displayValue.trim().toLowerCase();
                const bool =
                    normalizedDisplayValue === "true" || normalizedDisplayValue === "1" ? 1 : 0;
                parts.push(`<c r="${ref}" t="b"><v>${bool}</v></c>`);
            } else {
                parts.push(inlineStringCell(ref, cell.displayValue));
            }
        }
        parts.push(`</row>`);
    }

    parts.push(`</sheetData>`);
    parts.push(`</worksheet>`);
    return parts.join("");
}

function inlineStringCell(ref: string, value: string): string {
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Convert a 0-based column index to Excel's A, B, ..., Z, AA, AB, ... reference.
 */
function columnLetter(colIndex: number): string {
    let n = colIndex;
    let letters = "";
    do {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters;
}

function cellRef(colIndex: number, rowIndex: number): string {
    return `${columnLetter(colIndex)}${rowIndex}`;
}

function escapeXml(value: string): string {
    // Strip XML 1.0 illegal control characters (everything below 0x20 except
    // tab/newline/carriage-return) — Excel rejects files containing them.
    const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    return cleaned
        .split("&")
        .join("&amp;")
        .split("<")
        .join("&lt;")
        .split(">")
        .join("&gt;")
        .split('"')
        .join("&quot;")
        .split("'")
        .join("&apos;");
}

function isNumericType(col: IDbColumn): boolean {
    const t = (col.dataTypeName || col.dataType || "").toLowerCase();
    return (
        t === "int" ||
        t === "bigint" ||
        t === "smallint" ||
        t === "tinyint" ||
        t === "decimal" ||
        t === "numeric" ||
        t === "money" ||
        t === "smallmoney" ||
        t === "float" ||
        t === "real" ||
        t === "double"
    );
}

function isBooleanType(col: IDbColumn): boolean {
    const t = (col.dataTypeName || col.dataType || "").toLowerCase();
    return t === "bit" || t === "boolean" || t === "bool";
}

function isFiniteNumber(value: string): boolean {
    if (!value) {
        return false;
    }
    const n = Number(value);
    return Number.isFinite(n);
}
