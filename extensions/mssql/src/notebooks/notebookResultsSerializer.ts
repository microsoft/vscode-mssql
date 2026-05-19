/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import SqlToolsServerClient from "../languageservice/serviceclient";
import {
    SerializeColumnInfo,
    SerializeDataStartRequestParams,
    SerializeDbCellValue,
    SerializeStartRequest,
} from "../models/contracts";
import type { DbCellValue, IDbColumn } from "../sharedInterfaces/queryResult";
import type { NotebookSaveAsFormat } from "../sharedInterfaces/notebookQueryResult";

export interface SerializeOptions {
    format: NotebookSaveAsFormat;
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    notebookBaseName: string;
    notebookUri: vscode.Uri;
    resultSetIndex: number;
}

export async function saveNotebookResults(
    options: SerializeOptions,
): Promise<vscode.Uri | undefined> {
    const dialog = getDialogConfig(
        options.format,
        options.notebookBaseName,
        options.notebookUri,
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

    const params: SerializeDataStartRequestParams = {
        saveFormat: options.format,
        filePath: targetUri.fsPath,
        rows: toSerializeRows(options.rows),
        columns: toSerializeColumns(options.columnInfo),
        isLastBatch: true,
        includeHeaders: true,
    };

    const result = await SqlToolsServerClient.instance.sendRequest(
        SerializeStartRequest.type,
        params,
    );
    if (!result.succeeded) {
        throw new Error(result.messages || "Serialization failed");
    }
    return targetUri;
}

function toSerializeColumns(columnInfo: IDbColumn[]): SerializeColumnInfo[] {
    return columnInfo.map((col) => ({
        name: col.columnName,
        dataTypeName: col.dataTypeName ?? "nvarchar",
    }));
}

function toSerializeRows(rows: DbCellValue[][]): SerializeDbCellValue[][] {
    return rows.map((row) =>
        row.map((cell) => ({
            displayValue: cell?.displayValue ?? "",
            isNull: cell?.isNull ?? cell?.displayValue == null,
        })),
    );
}

interface DialogConfig {
    title: string;
    defaultUri: vscode.Uri;
    filters: Record<string, string[]>;
}

function getDialogConfig(
    format: NotebookSaveAsFormat,
    notebookBaseName: string,
    notebookUri: vscode.Uri,
    resultSetIndex: number,
): DialogConfig {
    const safeBase = sanitizeFileBase(notebookBaseName) || "results";
    const suffix = `_resultset_${resultSetIndex + 1}`;

    let baseUri: vscode.Uri;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(notebookUri)?.uri;
    if (workspaceFolder) {
        baseUri = workspaceFolder;
    } else if (vscode.workspace.workspaceFolders?.[0]) {
        baseUri = vscode.workspace.workspaceFolders[0].uri;
    } else if (notebookUri.scheme === "file") {
        const parentDir = path.dirname(notebookUri.fsPath);
        baseUri = vscode.Uri.file(parentDir);
    } else {
        baseUri = vscode.Uri.file(os.homedir());
    }

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
