/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue, IDbColumn, SelectionSummaryMetrics } from "./queryResult";

export interface NotebookQueryResultGridBlock {
    type: "resultSet";
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    rowCount: number;
}

export interface NotebookQueryResultTextBlock {
    type: "text";
    text: string;
}

export interface NotebookQueryResultErrorBlock {
    type: "error";
    text: string;
}

export type NotebookQueryResultBlock =
    | NotebookQueryResultGridBlock
    | NotebookQueryResultTextBlock
    | NotebookQueryResultErrorBlock;

export interface NotebookQueryResultOutputData {
    version: 1;
    blocks: NotebookQueryResultBlock[];
    copyAsCsvOptions?: NotebookCopyAsCsvOptions;
}

export interface NotebookCopyAsCsvOptions {
    delimiter: string;
    includeHeaders: boolean;
    lineSeparator: string;
    textIdentifier: string;
}

// Older notebook executions stored each result set as its own custom output item.
// Keep this shape readable so saved notebooks from earlier extension versions
// continue to render after upgrade.
export interface SavedNotebookResultSetOutputData {
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    rowCount: number;
    addBottomSpacing?: boolean;
}

export enum NotebookSaveAsFormat {
    Csv = "csv",
    Excel = "excel",
    Json = "json",
}

export interface NotebookSaveAsMessage {
    type: "saveAs";
    format: NotebookSaveAsFormat;
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    resultSetIndex: number;
}

/**
 * Sent by the notebook result renderer when the cell selection in a result grid
 * changes. Carries the metrics computed from the current selection, or undefined
 * when the selection is empty.
 */
export interface NotebookSelectionSummaryMessage {
    type: "selectionSummary";
    metrics: SelectionSummaryMetrics | undefined;
}

export interface NotebookShowErrorMessage {
    type: "showError";
    message: string;
}

export type NotebookRendererMessage =
    | NotebookSaveAsMessage
    | NotebookSelectionSummaryMessage
    | NotebookShowErrorMessage;
