/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue, IDbColumn } from "./queryResult";

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

export type NotebookSaveAsFormat = "csv" | "json" | "excel";

/**
 * Message sent from the notebook result renderer to the extension host
 * when the user clicks a save-as button in the result toolbar. Rows and
 * columns are sent inline because the renderer's only stable handle on its
 * data is the parsed output JSON — there is no API to resolve back to a
 * specific NotebookCellOutput from inside the renderer iframe.
 */
export interface NotebookSaveAsMessage {
    type: "saveAs";
    format: NotebookSaveAsFormat;
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    resultSetIndex: number;
}
