/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as localizedConstants from "../constants/locConstants";
import { getEditorEOL } from "../utils/utils";
import {
    BackgroundTaskLogEntry,
    BackgroundTaskLog,
    BackgroundTasksService,
    toBackgroundTaskStateDisplayString,
} from "./backgroundTasksService";

export class BackgroundTaskLogContentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private readonly _logSubscription: vscode.Disposable;

    constructor(private readonly _backgroundTasksService: BackgroundTasksService) {
        this._logSubscription = this._backgroundTasksService.onDidChangeTaskLog((taskId) => {
            this._onDidChange.fire(this.getUri(taskId));
        });
    }

    public readonly onDidChange = this._onDidChange.event;

    public getUri(taskId: string): vscode.Uri {
        const taskLog = this._backgroundTasksService.getTaskLog(taskId);
        const documentName = taskLog?.documentName ?? taskId;
        return vscode.Uri.from({
            scheme: Constants.backgroundTaskLogUriScheme,
            path: `/${documentName}.log`,
            query: `taskId=${encodeURIComponent(taskId)}`,
        });
    }

    public async showTaskLog(taskId: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(this.getUri(taskId));
        await vscode.window.showTextDocument(document, { preview: false });
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
                    new Date(entry.timestamp).toLocaleTimeString(),
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
