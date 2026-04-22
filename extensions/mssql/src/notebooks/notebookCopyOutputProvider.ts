/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import type {
    NotebookQueryResultBlock,
    NotebookQueryResultOutputData,
} from "../sharedInterfaces/notebookQueryResult";

const MIME_TEXT_PLAIN = "text/plain";
const MIME_STDERR = "application/vnd.code.notebook.stderr";
const MIME_NOTEBOOK_QUERY_RESULT = "application/vnd.mssql.query-result";

/**
 * Adds a "Copy messages" status bar item to SQL notebook cells that emit
 * text-only output (PRINT, RAISERROR, row-count, execution time, errors).
 *
 * The built-in text/plain renderer virtualizes long output, which breaks
 * cross-viewport selection (vscode-mssql#21378). This provider reads raw
 * output data from the cell model instead of the rendered DOM, so the
 * full content copies regardless of virtualization.
 *
 * When a cell emits a result grid, the controller bundles grid + messages
 * into a single rich output. We unpack its JSON payload and copy only the
 * text/error blocks, skipping the tabular data — users copy grid contents
 * through the grid itself, not this command.
 */
export function registerNotebookCopyOutput(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            Constants.cmdNotebooksCopyCellOutput,
            async (cell: vscode.NotebookCell | undefined) => {
                if (!cell) {
                    return;
                }
                const text = collectTextOutput(cell);
                if (!text) {
                    return;
                }
                await vscode.env.clipboard.writeText(text);
                vscode.window.setStatusBarMessage(
                    LocalizedConstants.Notebooks.copiedMessages,
                    2000,
                );
            },
        ),
    );

    context.subscriptions.push(
        vscode.notebooks.registerNotebookCellStatusBarItemProvider("jupyter-notebook", {
            provideCellStatusBarItems(cell) {
                if (cell.document.languageId !== "sql") {
                    return;
                }
                if (!cell.outputs.some(isCopyableTextOutput)) {
                    return;
                }
                const item = new vscode.NotebookCellStatusBarItem(
                    `$(copy) ${LocalizedConstants.Notebooks.copyMessages}`,
                    vscode.NotebookCellStatusBarAlignment.Right,
                );
                item.command = {
                    command: Constants.cmdNotebooksCopyCellOutput,
                    title: LocalizedConstants.Notebooks.copyMessages,
                    arguments: [cell],
                };
                item.tooltip = LocalizedConstants.Notebooks.copyMessagesTooltip;
                return item;
            },
        }),
    );
}

function isCopyableTextOutput(output: vscode.NotebookCellOutput): boolean {
    if (output.items.length === 0) {
        return false;
    }
    const rich = findRichItem(output);
    if (rich) {
        return extractRichMessageText(rich).length > 0;
    }
    return output.items.some((item) => item.mime === MIME_TEXT_PLAIN || item.mime === MIME_STDERR);
}

function collectTextOutput(cell: vscode.NotebookCell): string {
    const chunks: string[] = [];
    for (const output of cell.outputs) {
        const rich = findRichItem(output);
        if (rich) {
            chunks.push(...extractRichMessageText(rich));
            continue;
        }
        for (const item of output.items) {
            if (item.mime === MIME_TEXT_PLAIN || item.mime === MIME_STDERR) {
                chunks.push(Buffer.from(item.data).toString("utf8"));
            }
        }
    }
    return chunks.join(os.EOL);
}

function findRichItem(
    output: vscode.NotebookCellOutput,
): vscode.NotebookCellOutputItem | undefined {
    return output.items.find((item) => item.mime === MIME_NOTEBOOK_QUERY_RESULT);
}

function extractRichMessageText(item: vscode.NotebookCellOutputItem): string[] {
    let data: NotebookQueryResultOutputData;
    try {
        data = JSON.parse(Buffer.from(item.data).toString("utf8"));
    } catch {
        return [];
    }
    if (!data || !Array.isArray(data.blocks)) {
        return [];
    }
    return data.blocks
        .filter(
            (block): block is Exclude<NotebookQueryResultBlock, { type: "resultSet" }> =>
                block.type !== "resultSet",
        )
        .map((block) => block.text);
}
