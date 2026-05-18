/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { buildXlsx } from "./notebookExcelWriter";
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

    const payload = await serialize(options.format, options.columnInfo, options.rows);
    await vscode.workspace.fs.writeFile(targetUri, payload);
    return targetUri;
}

async function serialize(
    format: NotebookSaveAsFormat,
    columnInfo: IDbColumn[],
    rows: DbCellValue[][],
): Promise<Uint8Array> {
    switch (format) {
        case "csv":
            return Buffer.from(toCsv(columnInfo, rows), "utf8");
        case "json":
            return Buffer.from(toJson(columnInfo, rows), "utf8");
        case "excel":
            return buildXlsx(columnInfo, rows);
        default: {
            const exhaustive: never = format;
            throw new Error(`Unsupported save format: ${exhaustive}`);
        }
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
        case "excel":
            return {
                title: LocalizedConstants.Notebooks.saveAsExcelDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.xlsx`),
                filters: { Excel: ["xlsx"], "All files": ["*"] },
            };
        case "json":
            return {
                title: LocalizedConstants.Notebooks.saveAsJsonDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.json`),
                filters: { JSON: ["json"], "All files": ["*"] },
            };
    }
}

function sanitizeFileBase(name: string): string {
    return path.parse(name).name.replace(/[^\w.-]+/g, "_");
}
