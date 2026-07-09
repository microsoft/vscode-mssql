/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { Perf } from "../perf/perfTelemetry";
import {
    QsCellWindow,
    QsResultSelectionRange,
    QsResultSetSummary,
    QsSaveResultFormat,
} from "../sharedInterfaces/queryStudio";
import { cellDocumentText } from "./cellDocument";
import { resolveQueryTuning } from "./tuning/queryTuningResolver";

const INSERT_BATCH_SIZE = 1000;
/** Coalesce generator pieces into writes of roughly this many chars. */
const WRITE_BUFFER_CHARS = 256 * 1024;

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

    Perf.marker("mssql.queryStudio.export.begin", "begin", {
        format: options.format,
        rows: options.summary.rowCount,
    });
    try {
        const encoding = getExportEncoding(options.sourceUri, options.format);
        const outcome = await writeExport(target, options, encoding);
        Perf.marker("mssql.queryStudio.export.end", "end", {
            format: options.format,
            rows: outcome.rows,
            bytes: outcome.bytes,
            canceled: outcome.canceled === true,
            streamed: outcome.streamed,
        });
        if (outcome.canceled) {
            return { saved: false, canceled: true };
        }
        showSaveSucceededNotification(target);
        if (shouldOpenSavedFile(options.sourceUri)) {
            await openSavedFile(target);
        }
        return { saved: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Perf.marker("mssql.queryStudio.export.end", "end", {
            format: options.format,
            rows: 0,
            bytes: 0,
            canceled: false,
            streamed: false,
            error: true,
        });
        void vscode.window.showErrorMessage(LocalizedConstants.msgSaveFailed(message));
        return { saved: false, error: message };
    }
}

interface ExportOutcome {
    rows: number;
    bytes: number;
    canceled?: boolean;
    streamed: boolean;
}

/** One generator piece: text plus how many data rows it covers. */
interface ExportPiece {
    text: string;
    rows: number;
}

/**
 * Streaming export (QO-8): pieces flow from the format generator straight to
 * an incremental file write with progress + cancellation — output is never
 * accumulated as one giant string. Non-file targets (rare) fall back to
 * bounded in-memory assembly through the same generators.
 */
async function writeExport(
    target: vscode.Uri,
    options: ExportOptions,
    encoding: BufferEncoding,
): Promise<ExportOutcome> {
    const range = normalizeExportRange(options.summary, options.selection);
    const pieces = exportPieces(options, range);

    if (target.scheme !== "file") {
        let text = "";
        let rows = 0;
        for await (const piece of pieces) {
            text += piece.text;
            rows += piece.rows;
        }
        const payload = Buffer.from(text, encoding);
        await vscode.workspace.fs.writeFile(target, payload);
        return { rows, bytes: payload.byteLength, streamed: false };
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: LocalizedConstants.msgExportingResults,
            cancellable: true,
        },
        async (progress, token) => {
            const stream = fs.createWriteStream(target.fsPath, { encoding });
            let rows = 0;
            let bytes = 0;
            let buffer = "";
            const flush = async () => {
                if (buffer.length === 0) {
                    return;
                }
                const piece = buffer;
                buffer = "";
                bytes += Buffer.byteLength(piece, encoding);
                await streamWrite(stream, piece);
                progress.report({
                    message: `${rows.toLocaleString()} rows`,
                });
            };
            try {
                for await (const piece of pieces) {
                    if (token.isCancellationRequested) {
                        stream.destroy();
                        await fs.promises.rm(target.fsPath, { force: true });
                        return { rows, bytes, canceled: true, streamed: true };
                    }
                    buffer += piece.text;
                    rows += piece.rows;
                    if (buffer.length >= WRITE_BUFFER_CHARS) {
                        await flush();
                    }
                }
                await flush();
                await streamEnd(stream);
                return { rows, bytes, streamed: true };
            } catch (error) {
                stream.destroy();
                await fs.promises.rm(target.fsPath, { force: true }).catch(() => undefined);
                throw error;
            }
        },
    );
}

function streamWrite(stream: fs.WriteStream, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(text, (error) => (error ? reject(error) : resolve()));
    });
}

function streamEnd(stream: fs.WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.end((error: Error | null | undefined) => (error ? reject(error) : resolve()));
    });
}

/** Exported for unit tests (the save entrypoint needs a real Save dialog). */
export function exportPieces(
    options: ExportOptions,
    range: ExportRange,
): AsyncGenerator<ExportPiece> {
    switch (options.format) {
        case "csv":
            return csvPieces(options, range, getCsvOptions(options.sourceUri));
        case "json":
            return jsonPieces(options, range);
        case "insert":
            return insertPieces(options, range, getInsertOptions(options.sourceUri));
    }
}

/** Exported for unit tests. */
export function normalizeExportRange(
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

async function* csvPieces(
    options: ExportOptions,
    range: ExportRange,
    csv: CsvOptions,
): AsyncGenerator<ExportPiece> {
    if (csv.includeHeaders) {
        const header = options.summary.columnNames
            .slice(range.columnStart, range.columnEnd + 1)
            .map((name) => encodeCsvField(name, csv.delimiter, csv.textIdentifier))
            .join(csv.delimiter);
        yield { text: `${header}${csv.lineSeparator}`, rows: 0 };
    }

    for await (const row of readExportRows(options, range)) {
        const line = row.cells
            .slice(range.columnStart, range.columnEnd + 1)
            .map((cell) =>
                encodeCsvField(
                    cell.isNull ? undefined : cellDocumentText(cell.value),
                    csv.delimiter,
                    csv.textIdentifier,
                ),
            )
            .join(csv.delimiter);
        yield { text: `${line}${csv.lineSeparator}`, rows: 1 };
    }
}

async function* jsonPieces(
    options: ExportOptions,
    range: ExportRange,
): AsyncGenerator<ExportPiece> {
    let first = true;
    for await (const row of readExportRows(options, range)) {
        const properties: string[] = [];
        for (let column = range.columnStart; column <= range.columnEnd; column++) {
            properties.push(
                `    ${JSON.stringify(options.summary.columnNames[column] ?? "")}: ${jsonValue(row.cells[column])}`,
            );
        }
        const prefix = first ? "[\n" : ",\n";
        first = false;
        yield { text: `${prefix}  {\n${properties.join(",\n")}\n  }`, rows: 1 };
    }
    yield { text: first ? "[]\n" : "\n]\n", rows: 0 };
}

async function* insertPieces(
    options: ExportOptions,
    range: ExportRange,
    insert: InsertOptions,
): AsyncGenerator<ExportPiece> {
    if (options.summary.columnNames.length === 0 || range.rowEnd < range.rowStart) {
        return;
    }

    const columnNames = options.summary.columnNames.slice(range.columnStart, range.columnEnd + 1);
    const header = insert.includeHeaders
        ? ` (${columnNames.map(escapeIdentifier).join(", ")})`
        : "";
    let batch: string[] = [];
    const renderBatch = (): string => {
        const lines = [
            `INSERT INTO ${escapeIdentifier("TableName")}${header}`,
            "VALUES",
            ...batch.map((row, index) => `    ${row}${index < batch.length - 1 ? "," : ";"}`),
            "",
        ];
        const rendered = lines.join(insert.lineSeparator) + insert.lineSeparator;
        batch = [];
        return rendered;
    };

    for await (const row of readExportRows(options, range)) {
        const values = row.cells.slice(range.columnStart, range.columnEnd + 1).map(formatSqlValue);
        batch.push(`(${values.join(", ")})`);
        if (batch.length >= INSERT_BATCH_SIZE) {
            yield { text: renderBatch(), rows: INSERT_BATCH_SIZE };
        }
    }
    if (batch.length > 0) {
        const rows = batch.length;
        yield { text: renderBatch(), rows };
    }
}

async function* readExportRows(
    options: ExportOptions,
    range: ExportRange,
): AsyncGenerator<ExportRow> {
    if (range.rowEnd < range.rowStart) {
        return;
    }

    // Fetch size from the tuning registry (QO-1) — sweepable like the rest.
    const chunkRows = resolveQueryTuning().params.exportChunkRows;
    for (let start = range.rowStart; start <= range.rowEnd; start += chunkRows) {
        const count = Math.min(chunkRows, range.rowEnd - start + 1);
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
