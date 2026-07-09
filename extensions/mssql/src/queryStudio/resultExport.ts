/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import {
    QsCellWindow,
    QsResultSelectionRange,
    QsResultSetSummary,
    QsSaveResultFormat,
} from "../sharedInterfaces/queryStudio";
import { cellDocumentText } from "./cellDocument";

const EXPORT_CHUNK_SIZE = 2048;
const INSERT_BATCH_SIZE = 1000;

interface ExportOptions {
    sourceUri?: vscode.Uri;
    summary: QsResultSetSummary;
    format: QsSaveResultFormat;
    selection?: readonly QsResultSelectionRange[];
    getRows: (resultSetId: string, start: number, count: number) => Promise<QsCellWindow>;
}

interface CsvOptions {
    includeHeaders: boolean;
    delimiter: string;
    textIdentifier: string;
    lineSeparator: string;
    encoding: BufferEncoding;
}

interface InsertOptions {
    includeHeaders: boolean;
    lineSeparator: string;
    encoding: BufferEncoding;
}

interface ExportRange {
    rowStart: number;
    rowEnd: number;
    columnStart: number;
    columnEnd: number;
}

interface ExportCell {
    value: unknown;
    isNull: boolean;
}

interface ExportRow {
    cells: ExportCell[];
}

export async function saveQueryStudioResult(options: ExportOptions): Promise<{
    saved: boolean;
    canceled?: boolean;
    error?: string;
}> {
    const target = await promptForExportUri(options.sourceUri, options.format);
    if (!target) {
        return { saved: false, canceled: true };
    }

    try {
        const content = await buildExportContent(options);
        const encoding = getExportEncoding(options.sourceUri, options.format);
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, encoding));
        showSaveSucceededNotification(target);
        if (shouldOpenSavedFile(options.sourceUri)) {
            await openSavedFile(target);
        }
        return { saved: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(LocalizedConstants.msgSaveFailed(message));
        return { saved: false, error: message };
    }
}

async function buildExportContent(options: ExportOptions): Promise<string> {
    const range = normalizeExportRange(options.summary, options.selection);
    switch (options.format) {
        case "csv":
            return buildCsvContent(options, range, getCsvOptions(options.sourceUri));
        case "json":
            return buildJsonContent(options, range);
        case "insert":
            return buildInsertContent(options, range, getInsertOptions(options.sourceUri));
    }
}

function normalizeExportRange(
    summary: QsResultSetSummary,
    selection: readonly QsResultSelectionRange[] | undefined,
): ExportRange {
    const columnEnd = Math.max(0, summary.columnNames.length - 1);
    const full: ExportRange = {
        rowStart: 0,
        rowEnd: Math.max(-1, summary.rowCount - 1),
        columnStart: 0,
        columnEnd,
    };

    const first = selection?.[0];
    if (
        !first ||
        (first.fromRow === first.toRow && first.fromCell === first.toCell) ||
        summary.rowCount <= 0 ||
        summary.columnNames.length === 0
    ) {
        return full;
    }

    const rowStart = clamp(Math.min(first.fromRow, first.toRow), 0, summary.rowCount - 1);
    const rowEnd = clamp(Math.max(first.fromRow, first.toRow), 0, summary.rowCount - 1);
    const columnStart = clamp(Math.min(first.fromCell, first.toCell), 0, columnEnd);
    const selectedColumnEnd = clamp(Math.max(first.fromCell, first.toCell), 0, columnEnd);
    return { rowStart, rowEnd, columnStart, columnEnd: selectedColumnEnd };
}

async function buildCsvContent(
    options: ExportOptions,
    range: ExportRange,
    csv: CsvOptions,
): Promise<string> {
    const lines: string[] = [];
    if (csv.includeHeaders) {
        lines.push(
            options.summary.columnNames
                .slice(range.columnStart, range.columnEnd + 1)
                .map((name) => encodeCsvField(name, csv.delimiter, csv.textIdentifier))
                .join(csv.delimiter),
        );
    }

    for await (const row of readExportRows(options, range)) {
        lines.push(
            row.cells
                .slice(range.columnStart, range.columnEnd + 1)
                .map((cell) =>
                    encodeCsvField(
                        cell.isNull ? undefined : cellDocumentText(cell.value),
                        csv.delimiter,
                        csv.textIdentifier,
                    ),
                )
                .join(csv.delimiter),
        );
    }
    return lines.length > 0 ? `${lines.join(csv.lineSeparator)}${csv.lineSeparator}` : "";
}

async function buildJsonContent(options: ExportOptions, range: ExportRange): Promise<string> {
    const rows: string[] = [];
    for await (const row of readExportRows(options, range)) {
        const properties: string[] = [];
        for (let column = range.columnStart; column <= range.columnEnd; column++) {
            properties.push(
                `    ${JSON.stringify(options.summary.columnNames[column] ?? "")}: ${jsonValue(row.cells[column])}`,
            );
        }
        rows.push(`  {\n${properties.join(",\n")}\n  }`);
    }
    return rows.length > 0 ? `[\n${rows.join(",\n")}\n]\n` : "[]\n";
}

async function buildInsertContent(
    options: ExportOptions,
    range: ExportRange,
    insert: InsertOptions,
): Promise<string> {
    if (options.summary.columnNames.length === 0 || range.rowEnd < range.rowStart) {
        return "";
    }

    const columnNames = options.summary.columnNames.slice(range.columnStart, range.columnEnd + 1);
    const header = insert.includeHeaders
        ? ` (${columnNames.map(escapeIdentifier).join(", ")})`
        : "";
    const statements: string[] = [];
    let batch: string[] = [];
    const flush = () => {
        if (batch.length === 0) {
            return;
        }
        const lines = [
            `INSERT INTO ${escapeIdentifier("TableName")}${header}`,
            "VALUES",
            ...batch.map((row, index) => `    ${row}${index < batch.length - 1 ? "," : ";"}`),
            "",
        ];
        statements.push(lines.join(insert.lineSeparator));
        batch = [];
    };

    for await (const row of readExportRows(options, range)) {
        const values = row.cells.slice(range.columnStart, range.columnEnd + 1).map(formatSqlValue);
        batch.push(`(${values.join(", ")})`);
        if (batch.length >= INSERT_BATCH_SIZE) {
            flush();
        }
    }
    flush();
    return statements.length > 0
        ? `${statements.join(insert.lineSeparator)}${insert.lineSeparator}`
        : "";
}

async function* readExportRows(
    options: ExportOptions,
    range: ExportRange,
): AsyncGenerator<ExportRow> {
    if (range.rowEnd < range.rowStart) {
        return;
    }

    for (let start = range.rowStart; start <= range.rowEnd; start += EXPORT_CHUNK_SIZE) {
        const count = Math.min(EXPORT_CHUNK_SIZE, range.rowEnd - start + 1);
        const window = await options.getRows(options.summary.resultSetId, start, count);
        const isNull = windowNullFlags(window);
        for (let row = 0; row < window.values.length; row++) {
            const cells: ExportCell[] = [];
            for (let column = 0; column < options.summary.columnNames.length; column++) {
                cells.push({
                    value: window.values[row]?.[column],
                    isNull: isNull(row, column),
                });
            }
            yield { cells };
        }
        if (window.values.length < count) {
            return;
        }
    }
}

function windowNullFlags(window: QsCellWindow): (row: number, column: number) => boolean {
    const bytes = window.nullBitmap ? Buffer.from(window.nullBitmap, "base64") : undefined;
    const columnCount = window.columns.length;
    return (row, column) => {
        const value = window.values[row]?.[column];
        if (value === undefined || value === null) {
            return true;
        }
        if (!bytes) {
            return false;
        }
        const index = row * columnCount + column;
        const byteIndex = index >> 3;
        return byteIndex < bytes.length && (bytes[byteIndex] & (1 << (index & 7))) !== 0;
    };
}

function encodeCsvField(
    field: string | undefined,
    delimiter: string,
    textIdentifier: string,
): string {
    if (field === undefined) {
        return "NULL";
    }
    const escaped = field.split(textIdentifier).join(textIdentifier + textIdentifier);
    const needsQuotes =
        field.includes(delimiter) ||
        field.includes("\r") ||
        field.includes("\n") ||
        field.includes(textIdentifier) ||
        field.startsWith(" ") ||
        field.endsWith(" ") ||
        field.startsWith("\t") ||
        field.endsWith("\t");
    return needsQuotes ? `${textIdentifier}${escaped}${textIdentifier}` : escaped;
}

function jsonValue(cell: ExportCell | undefined): string {
    if (!cell || cell.isNull) {
        return "null";
    }
    return JSON.stringify(cellDocumentText(cell.value));
}

function formatSqlValue(cell: ExportCell | undefined): string {
    if (!cell || cell.isNull) {
        return "NULL";
    }
    const value = cellDocumentText(cell.value);
    if (!needsSqlStringQuotes(value)) {
        return value;
    }
    return `'${value.replace(/'/g, "''")}'`;
}

function needsSqlStringQuotes(value: string): boolean {
    return !isDecimalText(value) && !/^(true|false)$/i.test(value);
}

function isDecimalText(value: string): boolean {
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim());
}

function escapeIdentifier(identifier: string): string {
    if (!identifier) {
        return identifier;
    }
    if (identifier.includes(" ") || identifier.includes("-") || !/^[A-Za-z]/.test(identifier)) {
        return `[${identifier.replace(/\]/g, "]]")}]`;
    }
    return identifier;
}

function getCsvOptions(sourceUri: vscode.Uri | undefined): CsvOptions {
    const config = vscode.workspace.getConfiguration(
        Constants.extensionConfigSectionName,
        sourceUri,
    );
    const saveConfig =
        config.get<{
            includeHeaders?: boolean;
            delimiter?: string;
            lineSeparator?: string;
            lineSeperator?: string;
            textIdentifier?: string;
            encoding?: string;
        }>(Constants.configSaveAsCsv) ?? {};
    return {
        includeHeaders: saveConfig.includeHeaders ?? true,
        delimiter: firstChar(saveConfig.delimiter, ","),
        lineSeparator: saveConfig.lineSeparator ?? saveConfig.lineSeperator ?? os.EOL,
        textIdentifier: firstChar(saveConfig.textIdentifier, '"'),
        encoding: normalizeEncoding(saveConfig.encoding),
    };
}

function getInsertOptions(sourceUri: vscode.Uri | undefined): InsertOptions {
    const config = vscode.workspace.getConfiguration(
        Constants.extensionConfigSectionName,
        sourceUri,
    );
    const saveConfig =
        config.get<{ includeHeaders?: boolean; encoding?: string }>(Constants.configSaveAsCsv) ??
        {};
    return {
        includeHeaders: saveConfig.includeHeaders ?? true,
        lineSeparator: os.EOL,
        encoding: normalizeEncoding(saveConfig.encoding),
    };
}

function getExportEncoding(
    sourceUri: vscode.Uri | undefined,
    format: QsSaveResultFormat,
): BufferEncoding {
    switch (format) {
        case "csv":
            return getCsvOptions(sourceUri).encoding;
        case "insert":
            return getInsertOptions(sourceUri).encoding;
        case "json":
            return "utf8";
    }
}

function firstChar(value: string | undefined, fallback: string): string {
    return value && value.length > 0 ? value[0] : fallback;
}

function normalizeEncoding(encoding: string | undefined): BufferEncoding {
    if (!encoding) {
        return "utf8";
    }
    const normalized = encoding.toLowerCase().replace(/[-_]/g, "");
    switch (normalized) {
        case "utf8":
            return "utf8";
        case "utf16le":
        case "ucs2":
            return "utf16le";
        case "ascii":
            return "ascii";
        case "latin1":
        case "binary":
            return "latin1";
        default:
            return "utf8";
    }
}

async function promptForExportUri(
    sourceUri: vscode.Uri | undefined,
    format: QsSaveResultFormat,
): Promise<vscode.Uri | undefined> {
    return vscode.window.showSaveDialog({
        defaultUri: defaultExportUri(sourceUri, format),
        filters: exportFilters(format),
    });
}

function defaultExportUri(
    sourceUri: vscode.Uri | undefined,
    format: QsSaveResultFormat,
): vscode.Uri | undefined {
    if (!sourceUri || sourceUri.scheme !== "file") {
        return undefined;
    }
    const extension = format === "insert" ? "sql" : format;
    const baseName = path.basename(sourceUri.fsPath, path.extname(sourceUri.fsPath)) || "results";
    return vscode.Uri.file(path.join(path.dirname(sourceUri.fsPath), `${baseName}.${extension}`));
}

function exportFilters(format: QsSaveResultFormat): Record<string, string[]> {
    switch (format) {
        case "csv":
            return { [LocalizedConstants.fileTypeCSVLabel]: ["csv"] };
        case "json":
            return { [LocalizedConstants.fileTypeJSONLabel]: ["json"] };
        case "insert":
            return { "SQL Files": ["sql"] };
    }
}

function showSaveSucceededNotification(fileUri: vscode.Uri): void {
    const openFileAction = LocalizedConstants.Common.openFile;
    const revealFileAction = getRevealFileActionLabel();
    void vscode.window
        .showInformationMessage(
            LocalizedConstants.msgSaveSucceeded(fileUri.fsPath),
            openFileAction,
            revealFileAction,
        )
        .then((action) => {
            if (action === openFileAction) {
                void openSavedFile(fileUri);
            } else if (action === revealFileAction) {
                void vscode.commands.executeCommand("revealFileInOS", fileUri);
            }
        });
}

function shouldOpenSavedFile(sourceUri: vscode.Uri | undefined): boolean {
    const config = vscode.workspace.getConfiguration(
        Constants.extensionConfigSectionName,
        sourceUri,
    );
    return config.get<boolean>(Constants.configResultsOpenAfterSave, true);
}

async function openSavedFile(fileUri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false,
    });
}

function getRevealFileActionLabel(): string {
    if (process.platform === "darwin") {
        return LocalizedConstants.Common.revealInFinder;
    }
    if (process.platform === "win32") {
        return LocalizedConstants.Common.revealInExplorer;
    }
    return LocalizedConstants.Common.openContainingFolder;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
