/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import type { DbCellValue, IDbColumn } from "../sharedInterfaces/queryResult";
import type { NotebookSaveAsFormat } from "../sharedInterfaces/notebookQueryResult";

const CSV_DELIMITER = ",";
const CSV_TEXT_IDENTIFIER = '"';

export interface SerializeOptions {
    format: NotebookSaveAsFormat;
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    notebookBaseName: string;
    resultSetIndex: number;
}

/**
 * Prompt for a save location, serialize the result set, and write it to disk.
 * Returns the saved Uri on success, undefined if the user cancelled.
 */
export async function saveNotebookResults(
    options: SerializeOptions,
): Promise<vscode.Uri | undefined> {
    if (options.format === "excel") {
        void vscode.window.showInformationMessage(
            LocalizedConstants.Notebooks.excelExportNotSupported,
        );
        return undefined;
    }

    const dialog = getDialogConfig(
        options.format,
        options.notebookBaseName,
        options.resultSetIndex,
    );
    const targetUri = await vscode.window.showSaveDialog({
        title: dialog.title,
        defaultUri: dialog.defaultUri,
        filters: dialog.filters,
    });
    if (!targetUri) {
        return undefined;
    }

    const content = serialize(options.format, options.columnInfo, options.rows);
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, "utf8"));
    return targetUri;
}

function serialize(
    format: NotebookSaveAsFormat,
    columnInfo: IDbColumn[],
    rows: DbCellValue[][],
): string {
    switch (format) {
        case "csv":
            return toCsv(columnInfo, rows);
        case "json":
            return toJson(columnInfo, rows);
        case "insert":
            return toInsert(columnInfo, rows);
        default:
            throw new Error(`Unsupported save format: ${format}`);
    }
}

function toCsv(columnInfo: IDbColumn[], rows: DbCellValue[][]): string {
    const lines: string[] = [];
    lines.push(columnInfo.map((c) => csvQuote(c.columnName)).join(CSV_DELIMITER));
    for (const row of rows) {
        const cells = columnInfo.map((_, colIdx) => {
            const cell = row[colIdx];
            if (!cell || cell.isNull) {
                return "";
            }
            return csvQuote(cell.displayValue);
        });
        lines.push(cells.join(CSV_DELIMITER));
    }
    return lines.join(os.EOL) + os.EOL;
}

function csvQuote(value: string): string {
    // Always quote — matches the conservative default STS uses and avoids
    // edge cases with embedded delimiters, quotes, or newlines.
    const escaped = value
        .split(CSV_TEXT_IDENTIFIER)
        .join(CSV_TEXT_IDENTIFIER + CSV_TEXT_IDENTIFIER);
    return `${CSV_TEXT_IDENTIFIER}${escaped}${CSV_TEXT_IDENTIFIER}`;
}

function toJson(columnInfo: IDbColumn[], rows: DbCellValue[][]): string {
    const objects = rows.map((row) => {
        const obj: Record<string, string | null> = {};
        for (let i = 0; i < columnInfo.length; i++) {
            const cell = row[i];
            const key = columnInfo[i].columnName;
            obj[key] = cell?.isNull ? null : (cell?.displayValue ?? null);
        }
        return obj;
    });
    return JSON.stringify(objects, undefined, 4) + os.EOL;
}

function toInsert(columnInfo: IDbColumn[], rows: DbCellValue[][]): string {
    const tableName = inferTableName(columnInfo);
    const columnList = columnInfo.map((c) => bracketIdentifier(c.columnName)).join(", ");
    const lines: string[] = [];
    for (const row of rows) {
        const values = columnInfo.map((col, colIdx) => formatInsertValue(col, row[colIdx]));
        lines.push(`INSERT INTO ${tableName} (${columnList}) VALUES (${values.join(", ")});`);
    }
    return lines.join(os.EOL) + os.EOL;
}

function inferTableName(columnInfo: IDbColumn[]): string {
    // If every column comes from the same base table, use it. Otherwise fall
    // back to a placeholder — matches the standard grid's behavior for
    // multi-table or computed result sets.
    const tables = new Set<string>();
    let schema: string | undefined;
    for (const col of columnInfo) {
        if (col.baseTableName) {
            tables.add(col.baseTableName);
            if (!schema && col.baseSchemaName) {
                schema = col.baseSchemaName;
            }
        }
    }
    if (tables.size === 1) {
        const [table] = tables;
        return schema
            ? `${bracketIdentifier(schema)}.${bracketIdentifier(table)}`
            : bracketIdentifier(table);
    }
    return bracketIdentifier(LocalizedConstants.Notebooks.insertTableNamePlaceholder);
}

function bracketIdentifier(name: string): string {
    return `[${name.split("]").join("]]")}]`;
}

function formatInsertValue(col: IDbColumn, cell: DbCellValue | undefined): string {
    if (!cell || cell.isNull) {
        return "NULL";
    }
    const value = cell.displayValue;
    if (isNumericType(col)) {
        return value;
    }
    if (isBinaryType(col)) {
        // STS surfaces varbinary as 0x-prefixed hex strings; pass through unquoted
        // when present, otherwise fall back to a quoted literal.
        return /^0x[0-9a-fA-F]*$/.test(value) ? value : sqlStringLiteral(value);
    }
    if (isBooleanType(col)) {
        return value === "true" || value === "1" ? "1" : "0";
    }
    return sqlStringLiteral(value);
}

function sqlStringLiteral(value: string): string {
    return `N'${value.split("'").join("''")}'`;
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

function isBinaryType(col: IDbColumn): boolean {
    if (col.isBytes) {
        return true;
    }
    const t = (col.dataTypeName || col.dataType || "").toLowerCase();
    return t === "binary" || t === "varbinary" || t === "image" || t === "timestamp";
}

function isBooleanType(col: IDbColumn): boolean {
    const t = (col.dataTypeName || col.dataType || "").toLowerCase();
    return t === "bit" || t === "boolean" || t === "bool";
}

interface DialogConfig {
    title: string;
    defaultUri: vscode.Uri;
    filters: Record<string, string[]>;
}

function getDialogConfig(
    format: NotebookSaveAsFormat,
    notebookBaseName: string,
    resultSetIndex: number,
): DialogConfig {
    const safeBase = sanitizeFileBase(notebookBaseName) || "results";
    const suffix = `_resultset_${resultSetIndex + 1}`;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const home = vscode.Uri.file(os.homedir());
    const baseUri = workspaceFolder ?? home;

    switch (format) {
        case "csv":
            return {
                title: LocalizedConstants.Notebooks.saveAsCsvDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.csv`),
                filters: { CSV: ["csv"], "All files": ["*"] },
            };
        case "json":
            return {
                title: LocalizedConstants.Notebooks.saveAsJsonDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.json`),
                filters: { JSON: ["json"], "All files": ["*"] },
            };
        case "insert":
            return {
                title: LocalizedConstants.Notebooks.saveAsInsertDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.sql`),
                filters: { SQL: ["sql"], "All files": ["*"] },
            };
        case "excel":
            return {
                title: LocalizedConstants.Notebooks.saveAsExcelDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.xlsx`),
                filters: { Excel: ["xlsx"], "All files": ["*"] },
            };
    }
}

function sanitizeFileBase(name: string): string {
    return path.parse(name).name.replace(/[^\w.-]+/g, "_");
}
