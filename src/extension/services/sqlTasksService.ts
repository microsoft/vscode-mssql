/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { NotificationType, RequestType } from "vscode-languageclient";
import { TaskExecutionMode } from "vscode-mssql";
import { Deferred } from "../protocol";
import * as localizedConstants from "../constants/locConstants";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";

export enum TaskStatus {
    NotStarted = 0,
    InProgress = 1,
    Succeeded = 2,
    SucceededWithWarning = 3,
    Failed = 4,
    Canceled = 5,
    Canceling = 6,
}

// tslint:disable: interface-name
export interface TaskProgressInfo {
    taskId: string;
    status: TaskStatus;
    message: string;
    script?: string | undefined;
}

export interface TaskInfo {
    taskId: string;
    status: TaskStatus;
    taskExecutionMode: TaskExecutionMode;
    serverName: string;
    databaseName: string;
    name: string;
    description: string;
    providerName: string;
    isCancelable: boolean;
}

namespace TaskStatusChangedNotification {
    export const type = new NotificationType<TaskProgressInfo, void>("tasks/statuschanged");
}

namespace TaskCreatedNotification {
    export const type = new NotificationType<TaskInfo, void>("tasks/newtaskcreated");
}

interface CancelTaskParams {
    taskId: string;
}

namespace CancelTaskRequest {
    export const type = new RequestType<CancelTaskParams, boolean, void, void>("tasks/canceltask");
}

type ActiveTaskInfo = {
    taskInfo: TaskInfo;
    progressCallback: ProgressCallback;
    completionPromise: Deferred<void>;
    lastMessage?: string;
};
type ProgressCallback = (value: { message?: string; increment?: number }) => void;

/**
 * A simple service that hooks into the SQL Task Service feature provided by SQL Tools Service. This handles detecting when
 * new tasks are started and displaying a progress notification for those tasks while they're running.
 */
export class SqlTasksService {
    private _activeTasks = new Map<string, ActiveTaskInfo>();

    constructor(
        private _client: SqlToolsServiceClient,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
    ) {
        this._client.onNotification(TaskCreatedNotification.type, (taskInfo) =>
            this.handleTaskCreatedNotification(taskInfo),
        );
        this._client.onNotification(TaskStatusChangedNotification.type, (taskProgressInfo) =>
            this.handleTaskChangedNotification(taskProgressInfo),
        );
    }

    private cancelTask(taskId: string): Thenable<boolean> {
        const params: CancelTaskParams = {
            taskId,
        };
        return this._client.sendRequest(CancelTaskRequest.type, params);
    }

    /**
     * Handles a new task being created. This will start up a progress notification toast for the task and set up
     * callbacks to update the status of that task as it runs.
     * @param taskInfo The info for the new task that was created
     */
    private handleTaskCreatedNotification(taskInfo: TaskInfo): void {
        // Default to no-op for the progressCallback since we don't have the progress callback from the notification yet. There's
        // potential here for a race condition in which the first update comes in before this callback is updated - if that starts
        // happening then we'd want to look into keeping track of the latest update message to display as soon as the progress
        // callback is set such that we update the notification correctly.
        const newTaskInfo: ActiveTaskInfo = {
            taskInfo,
            progressCallback: () => {
                return;
            },
            completionPromise: new Deferred<void>(),
        };

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: taskInfo.name,
                cancellable: taskInfo.isCancelable,
            },
            async (progress, token): Promise<void> => {
                newTaskInfo.progressCallback = (value) => progress.report(value);
                token.onCancellationRequested(() => {
                    this.cancelTask(taskInfo.taskId);
                });
                await newTaskInfo.completionPromise;
            },
        );
        this._activeTasks.set(taskInfo.taskId, newTaskInfo);
    }

    /**
     * Handles an update to an existing task, updating the current progress notification as needed with any new
     * status/messages. If the task is completed then completes the progress notification and displays a final toast
     * informing the user that the task was completed.
     * @param taskProgressInfo The progress info for the task
     */
    private async handleTaskChangedNotification(taskProgressInfo: TaskProgressInfo): Promise<void> {
        const taskInfo = this._activeTasks.get(taskProgressInfo.taskId);
        if (!taskInfo) {
            console.warn(`Status update for unknown task ${taskProgressInfo.taskId}`!);
            return;
        }
        const taskStatusString = toTaskStatusDisplayString(taskProgressInfo.status);
        if (
            taskProgressInfo.message &&
            taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()
        ) {
            taskInfo.lastMessage = taskProgressInfo.message;
        }

        if (isTaskCompleted(taskProgressInfo.status)) {
            // Task is completed, complete the progress notification and display a final toast informing the
            // user of the final status.
            this._activeTasks.delete(taskProgressInfo.taskId);
            if (taskProgressInfo.status === TaskStatus.Canceled) {
                taskInfo.completionPromise.reject(new Error("Task cancelled"));
            } else {
                taskInfo.completionPromise.resolve();
            }

            // Get the message to display, if the last status doesn't have a valid message then get the last valid one
            const lastMessage =
                (taskProgressInfo.message &&
                    taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()) ??
                taskInfo.lastMessage;
            // Only include the message if it isn't the same as the task status string we already have - some (but not all) task status
            // notifications include this string as the message
            const taskMessage = lastMessage
                ? localizedConstants.taskStatusWithNameAndMessage(
                      taskInfo.taskInfo.name,
                      taskStatusString,
                      lastMessage.toString(),
                  )
                : localizedConstants.taskStatusWithName(taskInfo.taskInfo.name, taskStatusString);
            showCompletionMessage(taskProgressInfo.status, taskMessage);
            if (
                taskInfo.taskInfo.taskExecutionMode === TaskExecutionMode.script &&
                taskProgressInfo.script
            ) {
                await this._untitledSqlDocumentService.newQuery(taskProgressInfo.script);
            }
        } else {
            // Task is still ongoing so just update the progress notification with the latest status

            // The progress notification already has the name, so we just need to update the message with the latest status info.
            // Only include the message if it isn't the same as the task status string we already have - some (but not all) task status
            // notifications include this string as the message
            const taskMessage =
                taskProgressInfo.message &&
                taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()
                    ? localizedConstants.taskStatusWithNameAndMessage(
                          taskInfo.taskInfo.name,
                          taskStatusString,
                          taskProgressInfo.message,
                      )
                    : taskStatusString;
            taskInfo.progressCallback({ message: taskMessage });
        }
    }
}

/**
 * Determines whether a particular TaskStatus indicates that the task is completed.
 * @param taskStatus The task status to check
 * @returns true if the task is considered completed, false if not
 */
function isTaskCompleted(taskStatus: TaskStatus): boolean {
    return (
        taskStatus === TaskStatus.Canceled ||
        taskStatus === TaskStatus.Failed ||
        taskStatus === TaskStatus.Succeeded ||
        taskStatus === TaskStatus.SucceededWithWarning
    );
}

/**
 * Shows a message for a task with a different type of toast notification being used for
 * different status types.
 *  Failed - Error notification
 *  Canceled or SucceededWithWarning - Warning notification
 *  All others - Information notification
 * @param taskStatus The status of the task we're showing the message for
 * @param message The message to show
 */
function showCompletionMessage(taskStatus: TaskStatus, message: string): void {
    if (taskStatus === TaskStatus.Failed) {
        vscode.window.showErrorMessage(message);
    } else if (
        taskStatus === TaskStatus.Canceled ||
        taskStatus === TaskStatus.SucceededWithWarning
    ) {
        vscode.window.showWarningMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

/**
 * Gets the string to display for the specified task status
 * @param taskStatus The task status to get the display string for
 * @returns The display string for the task status, or the task status directly as a string if we don't have a mapping
 */
function toTaskStatusDisplayString(taskStatus: TaskStatus): string {
    switch (taskStatus) {
        case TaskStatus.Canceled:
            return localizedConstants.canceled;
        case TaskStatus.Failed:
            return localizedConstants.failed;
        case TaskStatus.Succeeded:
            return localizedConstants.succeeded;
        case TaskStatus.SucceededWithWarning:
            return localizedConstants.succeededWithWarning;
        case TaskStatus.InProgress:
            return localizedConstants.inProgress;
        case TaskStatus.Canceling:
            return localizedConstants.canceling;
        case TaskStatus.NotStarted:
            return localizedConstants.notStarted;
        default:
            console.warn(`Don't have display string for task status ${taskStatus}`);
            return (<any>taskStatus).toString(); // Typescript warns that we can never get here because we've used all the enum values so cast to any
    }
}
