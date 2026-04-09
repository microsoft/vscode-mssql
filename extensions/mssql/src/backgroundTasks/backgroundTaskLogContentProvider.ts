/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as localizedConstants from "../constants/locConstants";
import { getEditorEOL } from "../utils/utils";
import {
    BackgroundTaskLog,
    BackgroundTaskLogEntry,
    BackgroundTasksService,
    toBackgroundTaskStateDisplayString,
} from "./backgroundTasksService";

export class BackgroundTaskLogContentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private readonly _logSubscription: vscode.Disposable;
    private readonly _uris = new Map<string, vscode.Uri>();

    constructor(private readonly _backgroundTasksService: BackgroundTasksService) {
        this._logSubscription = this._backgroundTasksService.onDidChangeTaskLog((taskId) => {
            const uri = this.getUri(taskId);
            this._onDidChange.fire(uri);

            const taskLog = this._backgroundTasksService.getTaskLog(taskId);
            if (taskLog?.entries.length) {
                void this.revealLatestVisibleLogEntry(uri);
            }
        });
    }

    public readonly onDidChange = this._onDidChange.event;

    public getUri(taskId: string): vscode.Uri {
        const existingUri = this._uris.get(taskId);
        if (existingUri) {
            return existingUri;
        }

        const taskLog = this._backgroundTasksService.getTaskLog(taskId);
        const documentName = sanitizeDocumentName(taskLog?.displayText ?? taskId);
        const uri = vscode.Uri.from({
            scheme: Constants.backgroundTaskLogUriScheme,
            path: `/${documentName}.log`,
            query: `taskId=${encodeURIComponent(taskId)}`,
        });

        this._uris.set(taskId, uri);
        return uri;
    }

    public async showTaskLog(taskId: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(this.getUri(taskId));
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        this.revealLatestLogEntry(editor);
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        const taskId = new URLSearchParams(uri.query).get("taskId");
        if (!taskId) {
            return localizedConstants.backgroundTaskLogUnavailable;
        }

        const taskLog = this._backgroundTasksService.getTaskLog(taskId);
        if (!taskLog) {
            return localizedConstants.backgroundTaskLogUnavailable;
        }

        return renderTaskLog(taskLog);
    }

    public dispose(): void {
        this._logSubscription.dispose();
        this._onDidChange.dispose();
        this._uris.clear();
    }

    private async revealLatestVisibleLogEntry(uri: vscode.Uri): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));

        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) {
                this.revealLatestLogEntry(editor);
            }
        }
    }

    private revealLatestLogEntry(editor: vscode.TextEditor): void {
        const lastLine = editor.document.lineCount - 1;
        if (lastLine < 0) {
            return;
        }

        const position = new vscode.Position(lastLine, 0);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.Default,
        );
    }
}

function renderTaskLog(taskLog: BackgroundTaskLog): string {
    const editorEOL = getEditorEOL();
    const sections = [
        localizedConstants.backgroundTaskName(taskLog.displayText),
        localizedConstants.backgroundTaskStatus(toBackgroundTaskStateDisplayString(taskLog.state)),
    ];

    if (taskLog.source) {
        sections.push(localizedConstants.backgroundTaskSource(taskLog.source));
    }

    if (taskLog.details) {
        sections.push(localizedConstants.backgroundTaskConnection(taskLog.details));
    }

    if (taskLog.target) {
        sections.push(localizedConstants.backgroundTaskTarget(taskLog.target));
    }

    if (taskLog.description) {
        sections.push(localizedConstants.backgroundTaskDescription(taskLog.description));
    }

    sections.push("");
    sections.push(localizedConstants.backgroundTaskLogsHeader);

    if (taskLog.entries.length === 0) {
        sections.push(localizedConstants.backgroundTaskNoLogEntries);
    } else {
        sections.push(
            ...taskLog.entries.map((entry) =>
                localizedConstants.backgroundTaskLogLine(
                    formatTaskLogTimestamp(entry.timestamp),
                    renderTaskLogEntry(entry),
                ),
            ),
        );
    }

    return sections.join(editorEOL);
}

function renderTaskLogEntry(entry: BackgroundTaskLogEntry): string {
    const status = toBackgroundTaskStateDisplayString(entry.state);

    if (entry.percent !== undefined && entry.message) {
        return localizedConstants.backgroundTaskLogStateWithProgressAndMessage(
            status,
            entry.percent,
            entry.message,
        );
    }

    if (entry.percent !== undefined) {
        return localizedConstants.backgroundTaskLogStateWithProgress(status, entry.percent);
    }

    if (entry.message) {
        return localizedConstants.backgroundTaskLogStateWithMessage(status, entry.message);
    }

    return status;
}

function formatTaskLogTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return (
        [
            padClockSegment(date.getHours()),
            padClockSegment(date.getMinutes()),
            padClockSegment(date.getSeconds()),
        ].join(":") + `.${padMilliseconds(date.getMilliseconds())}`
    );
}

function padClockSegment(value: number): string {
    return value.toString().padStart(2, "0");
}

function padMilliseconds(value: number): string {
    return value.toString().padStart(3, "0");
}

function sanitizeDocumentName(name: string): string {
    const sanitizedName = name.replace(/[\\/:*?"<>|]/g, "-").trim();
    return sanitizedName || "background-task-log";
}
