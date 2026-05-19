/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { buildXlsx } from "./notebookExcelWriter";
import { sanitizeCsvValue } from "../profiler/csvUtils";
import type { DbCellValue, IDbColumn } from "../sharedInterfaces/queryResult";
import type { NotebookSaveAsFormat } from "../sharedInterfaces/notebookQueryResult";

interface CsvConfig {
    delimiter: string;
    textIdentifier: string;
    lineSeparator: string;
    includeHeaders: boolean;
    encoding: string;
}

export function getCsvConfig(): CsvConfig {
    const config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName);
    const saveConfig = config.get(Constants.configSaveAsCsv) as any;

    return {
        delimiter: saveConfig?.delimiter ?? ",",
        textIdentifier: saveConfig?.textIdentifier ?? '"',
        lineSeparator: saveConfig?.lineSeparator ?? os.EOL,
        includeHeaders: saveConfig?.includeHeaders !== false,
        encoding: saveConfig?.encoding ?? "utf8",
    };
}

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
        case "csv": {
            const csvConfig = getCsvConfig();
            return Buffer.from(
                toCsv(columnInfo, rows, csvConfig),
                mapToNodeEncoding(csvConfig.encoding),
            );
        }
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

export function toCsv(columnInfo: IDbColumn[], rows: DbCellValue[][], config: CsvConfig): string {
    const lines: string[] = [];

    if (config.includeHeaders) {
        lines.push(columnInfo.map((c) => csvQuote(c.columnName, config)).join(config.delimiter));
    }

    for (const row of rows) {
        const cells = columnInfo.map((_, colIdx) => {
            const cell = row[colIdx];
            if (!cell || cell.isNull) {
                return "";
            }
            return csvQuote(cell.displayValue, config);
        });
        lines.push(cells.join(config.delimiter));
    }
    return lines.join(config.lineSeparator) + config.lineSeparator;
}

function csvQuote(value: string, config: CsvConfig): string {
    // Sanitize to prevent formula injection
    const sanitized = sanitizeCsvValue(value);

    // Always quote — matches the conservative default STS uses and avoids
    // edge cases with embedded delimiters, quotes, or newlines.
    const escaped = sanitized
        .split(config.textIdentifier)
        .join(config.textIdentifier + config.textIdentifier);
    return `${config.textIdentifier}${escaped}${config.textIdentifier}`;
}

export function toJson(columnInfo: IDbColumn[], rows: DbCellValue[][]): string {
    // Disambiguate duplicate column names by appending a numeric suffix
    const columnKeys = disambiguateColumnNames(columnInfo);

    const objects = rows.map((row) => {
        const obj: Record<string, string | null> = {};
        for (let i = 0; i < columnInfo.length; i++) {
            const cell = row[i];
            const key = columnKeys[i];
            obj[key] = cell?.isNull ? null : (cell?.displayValue ?? null);
        }
        return obj;
    });
    return JSON.stringify(objects, undefined, 4) + os.EOL;
}

function disambiguateColumnNames(columnInfo: IDbColumn[]): string[] {
    const keys: string[] = [];
    const usedKeys = new Set<string>();
    const nextSuffixName = new Map<string, number>();

    for (const col of columnInfo) {
        const name = col.columnName;

        if (!usedKeys.has(name)) {
            keys.push(name);
            usedKeys.add(name);
        } else {
            let suffix = nextSuffixName.get(name) ?? 1;
            let candidate = `${name}_${suffix}`;

            while (usedKeys.has(candidate)) {
                suffix++;
                candidate = `${name}_${suffix}`;
            }

            keys.push(candidate);
            usedKeys.add(candidate);
            nextSuffixName.set(name, suffix + 1);
        }
    }

    return keys;
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
                filters: {
                    [LocalizedConstants.fileTypeCSVLabel]: ["csv"],
                    [LocalizedConstants.fileTypeAllFilesLabel]: ["*"],
                },
            };
        case "excel":
            return {
                title: LocalizedConstants.Notebooks.saveAsExcelDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.xlsx`),
                filters: {
                    [LocalizedConstants.fileTypeExcelLabel]: ["xlsx"],
                    [LocalizedConstants.fileTypeAllFilesLabel]: ["*"],
                },
            };
        case "json":
            return {
                title: LocalizedConstants.Notebooks.saveAsJsonDialogTitle,
                defaultUri: vscode.Uri.joinPath(baseUri, `${safeBase}${suffix}.json`),
                filters: {
                    [LocalizedConstants.fileTypeJSONLabel]: ["json"],
                    [LocalizedConstants.fileTypeAllFilesLabel]: ["*"],
                },
            };
    }
}

function sanitizeFileBase(name: string): string {
    return path.parse(name).name.replace(/[^\w.-]+/g, "_");
}

/**
 * Maps user-configured encoding strings to Node.js BufferEncoding.
 * Handles differences between STS encoding names (used in settings)
 * and Node.js BufferEncoding (used in notebooks).
 */
export function mapToNodeEncoding(encoding: string): BufferEncoding {
    const normalized = encoding.toLowerCase().replace(/[_-]/g, "");
    switch (normalized) {
        case "utf8":
            return "utf8";
        case "utf16le":
        case "ucs2":
            return "utf16le";
        case "utf16be":
            // Node doesn't support utf16be natively; fall back to utf16le
            return "utf16le";
        case "ascii":
            return "ascii";
        case "latin1":
        case "iso88591":
            return "latin1";
        default:
            // Fallback to utf8 for unsupported encodings
            return "utf8";
    }
}
