/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { NotificationType, RequestType } from "vscode-languageclient";
import * as localizedConstants from "../constants/locConstants";
import SqlDocumentService, { ConnectionStrategy } from "../controllers/sqlDocumentService";
import { TaskExecutionMode } from "../enums";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import {
    BackgroundTaskHandle,
    BackgroundTasksService,
    BackgroundTaskState,
} from "../backgroundTasks/backgroundTasksService";

export enum TaskStatus {
    NotStarted = 0,
    InProgress = 1,
    Succeeded = 2,
    SucceededWithWarning = 3,
    Failed = 4,
    Canceled = 5,
    CancelRequested = 6,
}

// tslint:disable: interface-name
export interface TaskProgressInfo {
    taskId: string;
    status: TaskStatus;
    message: string;
    script?: string | undefined;
    duration?: number;
    percentComplete?: number;
    progressMessage?: string;
}

export interface TaskMessage {
    status: TaskStatus;
    description: string;
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
    targetLocation: string;
    operationName?: string;
    percentComplete?: number;
    progressMessage?: string;
    messages?: TaskMessage[];
    duration?: number;
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
    backgroundTaskHandle?: BackgroundTaskHandle;
    lastMessage?: string;
    /** Script content received from any notification, used as fallback when script arrives out of order */
    script?: string;
    /**
     * Stored completion status when a script-mode task completes before its script notification arrives.
     * When a subsequent notification delivers the script, this stored status is replayed to finish the task.
     */
    completedStatus?: TaskProgressInfo;
};

/**
 * Arguments to pass to a VS Code command when an action button is clicked.
 * These are passed directly to vscode.commands.executeCommand via the spread operator.
 */
type ActionCommandArgs = Array<string | vscode.Uri>;

/**
 * Configuration for a custom task completion handler that shows a notification with an action button
 */
export interface TaskCompletionHandler {
    /**
     * The operation ID to handle (must match taskInfo.taskOperation from SQL Tools Service)
     */
    operationName: string;

    /**
     * Resolves the target location from the task info.
     * For file operations, this might return taskInfo.targetLocation.
     * For database operations, this might return taskInfo.databaseName.
     * @param taskInfo The task information
     * @returns The target location string, or undefined if not available
     */
    getTargetLocation: (taskInfo: TaskInfo) => string | undefined;

    /**
     * Gets the success message to display when the task completes successfully
     * @param taskInfo The task information
     * @param targetLocation The resolved target location
     * @returns The localized success message to display
     */
    getSuccessMessage: (taskInfo: TaskInfo, targetLocation: string) => string;

    /**
     * The localized action button text (e.g., "Reveal in Explorer")
     * Optional - if not provided, no action button will be shown
     */
    actionButtonText?: string;

    /**
     * The VS Code command to execute when the action button is clicked
     * Optional - required only if actionButtonText is provided
     */
    actionCommand?: string;

    /**
     * Gets the command arguments to pass when executing the action
     * Optional - required only if actionButtonText is provided
     * @param taskInfo The task information
     * @param targetLocation The resolved target location
     * @returns The command arguments
     */
    getActionCommandArgs?: (taskInfo: TaskInfo, targetLocation: string) => ActionCommandArgs;

    sendNotification?(NotificationType: NotificationType<any, void>, params: any): void;
}

/**
 * Event that is fired when a task is created
 * This allows other components to listen for new tasks and react accordingly
 */
export const taskCreatedEmitter = new vscode.EventEmitter<TaskInfo>();
export const onTaskCreated = taskCreatedEmitter.event;

/**
 * Event that is fired when a task is completed
 * This allows other components to listen for task completions and react accordingly
 */
export interface TaskCompletedEvent {
    task: TaskInfo;
    progress: TaskProgressInfo;
}
export const taskCompletedEmitter = new vscode.EventEmitter<TaskCompletedEvent>();
export const onTaskCompleted = taskCompletedEmitter.event;

/**
 * A simple service that hooks into the SQL Task Service feature provided by SQL Tools Service. This handles detecting when
 * new tasks are started and displaying a progress notification for those tasks while they're running.
 */
export class SqlTasksService {
    private _activeTasks = new Map<string, ActiveTaskInfo>();
    private _completionHandlers = new Map<string, TaskCompletionHandler>();

    constructor(
        private _client: SqlToolsServiceClient,
        private _sqlDocumentService: SqlDocumentService,
        private _vscodeWrapper: VscodeWrapper,
        private _backgroundTasksService?: BackgroundTasksService,
    ) {
        this._client.onNotification(TaskCreatedNotification.type, (taskInfo) =>
            this.handleTaskCreatedNotification(taskInfo),
        );
        this._client.onNotification(TaskStatusChangedNotification.type, (taskProgressInfo) =>
            this.handleTaskChangedNotification(taskProgressInfo),
        );
    }

    /**
     * Registers a custom completion handler for successful task completions.
     * This handler is ONLY invoked when a task completes successfully.
     * The handler will show a custom notification with an optional action button.
     * @param handler The task completion handler configuration
     */
    public registerCompletionSuccessHandler(handler: TaskCompletionHandler): void {
        // Emit telemetry if a handler for this operation is being overwritten
        if (this._completionHandlers.has(handler.operationName)) {
            sendActionEvent(TelemetryViews.General, TelemetryActions.Initialize, {
                event: "CompletionHandlerOverwritten",
                operationName: handler.operationName,
            });
            this._client.logger.error(
                `There is an existing completion handler for operation ${handler.operationName} cannot be overwritten.`,
            );
        } else {
            this._completionHandlers.set(handler.operationName, handler);
        }
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
        const newTaskInfo: ActiveTaskInfo = {
            taskInfo,
            backgroundTaskHandle: this._backgroundTasksService?.registerTask({
                displayText: taskInfo.name,
                details: this.createBackgroundTaskDetails(taskInfo),
                tooltip: this.createBackgroundTaskTooltip(taskInfo),
                canCancel: taskInfo.isCancelable,
                cancel: taskInfo.isCancelable
                    ? async () => {
                          await this.cancelTask(taskInfo.taskId);
                      }
                    : undefined,
                source: taskInfo.providerName,
                message: taskInfo.progressMessage ?? taskInfo.description,
                state: toBackgroundTaskState(taskInfo.status),
                percent:
                    taskInfo.percentComplete !== undefined && taskInfo.percentComplete >= 0
                        ? taskInfo.percentComplete
                        : undefined,
            }),
        };
        this._activeTasks.set(taskInfo.taskId, newTaskInfo);

        // Fire the task created event for any listeners
        taskCreatedEmitter.fire(taskInfo);
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

        const backgroundTaskMessage =
            taskProgressInfo.message &&
            taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()
                ? taskProgressInfo.message
                : taskInfo.lastMessage;

        // Always store script content from any notification that has one.
        // STS sends script content via a ScriptAdded notification that may arrive
        // out of order relative to the final StatusChanged notification.
        if (taskProgressInfo.script !== undefined) {
            taskInfo.script = taskProgressInfo.script;
        }

        if (isTaskCompleted(taskProgressInfo.status)) {
            const scriptContent = taskProgressInfo.script ?? taskInfo.script;

            // For script-mode tasks, if we don't have a script yet and haven't already
            // deferred, wait for a subsequent notification that may carry the script.
            // This handles the race condition where STS sends the final status notification
            // (without script) before the script notification due to non-FIFO message ordering
            // in the AsyncLock (SemaphoreSlim) used for parallel message processing.
            if (
                taskInfo.taskInfo.taskExecutionMode === TaskExecutionMode.script &&
                scriptContent === undefined &&
                !taskInfo.completedStatus
            ) {
                taskInfo.completedStatus = taskProgressInfo;
                taskInfo.backgroundTaskHandle?.update({
                    message: backgroundTaskMessage,
                    state: toBackgroundTaskState(taskProgressInfo.status),
                    canCancel: false,
                });
                return;
            }

            // Check if there's a custom completion handler registered for this task
            const handler = taskInfo.taskInfo.operationName
                ? this._completionHandlers.get(taskInfo.taskInfo.operationName)
                : undefined;

            // Fire the task completed event for any listeners
            taskCompletedEmitter.fire({ task: taskInfo.taskInfo, progress: taskProgressInfo });

            // Task is completed, complete the progress notification and display a final toast informing the
            // user of the final status.
            this._activeTasks.delete(taskProgressInfo.taskId);

            const targetLocation = handler
                ? handler.getTargetLocation(taskInfo.taskInfo)
                : undefined;
            const backgroundTaskOpenHandler =
                taskProgressInfo.status === TaskStatus.Succeeded
                    ? this.createBackgroundTaskOpenHandler(
                          taskInfo.taskInfo,
                          handler,
                          targetLocation,
                      )
                    : undefined;

            taskInfo.backgroundTaskHandle?.complete(
                toBackgroundTaskState(taskProgressInfo.status),
                {
                    message: backgroundTaskMessage,
                    open: backgroundTaskOpenHandler,
                    canCancel: false,
                },
            );

            if (taskProgressInfo.status === TaskStatus.Succeeded && handler && targetLocation) {
                // Show custom notification with optional action button
                const successMessage = handler.getSuccessMessage(taskInfo.taskInfo, targetLocation);
                const actionButtonText = handler.actionButtonText;

                if (actionButtonText && handler.actionCommand && handler.getActionCommandArgs) {
                    // Show notification with action button
                    void Promise.resolve(
                        this._vscodeWrapper.showInformationMessage(
                            successMessage,
                            actionButtonText,
                        ),
                    ).then((selection) => {
                        if (selection === actionButtonText) {
                            const command = handler.actionCommand!;
                            const args = handler.getActionCommandArgs!(
                                taskInfo.taskInfo,
                                targetLocation,
                            );
                            void this._vscodeWrapper.executeCommand(command, ...args);
                        }
                    });
                } else {
                    // Show notification without action button
                    void this._vscodeWrapper.showInformationMessage(successMessage);
                }
            } else {
                // Show generic completion message for tasks without custom handlers
                const lastMessage =
                    taskProgressInfo.message &&
                    taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()
                        ? taskProgressInfo.message
                        : taskInfo.lastMessage;

                const taskMessage = lastMessage
                    ? localizedConstants.taskStatusWithNameAndMessage(
                          taskInfo.taskInfo.name,
                          taskStatusString,
                          lastMessage.toString(),
                      )
                    : localizedConstants.taskStatusWithName(
                          taskInfo.taskInfo.name,
                          taskStatusString,
                      );
                this.showCompletionMessage(taskProgressInfo.status, taskMessage);
            }

            if (
                taskInfo.taskInfo.taskExecutionMode === TaskExecutionMode.script &&
                scriptContent !== undefined
            ) {
                await this._sqlDocumentService.newQuery({
                    content: scriptContent,
                    connectionStrategy: ConnectionStrategy.CopyLastActive,
                });
            }
        } else if (taskInfo.completedStatus && taskInfo.script !== undefined) {
            // A non-completed notification delivered the script we were waiting for.
            // Re-process the deferred completion now that the script is available.
            await this.handleTaskChangedNotification(taskInfo.completedStatus);
        } else {
            // Task is still ongoing so just update the progress notification
            const progressMsgPrefix = taskProgressInfo.progressMessage
                ? `[${taskProgressInfo.progressMessage}] `
                : "";
            const currentPercent =
                taskProgressInfo.percentComplete !== undefined &&
                taskProgressInfo.percentComplete >= 0
                    ? taskProgressInfo.percentComplete
                    : undefined;

            const backgroundMessage =
                taskProgressInfo.message &&
                taskProgressInfo.message.toLowerCase() !== taskStatusString.toLowerCase()
                    ? `${progressMsgPrefix}${taskProgressInfo.message}`
                    : (taskProgressInfo.progressMessage ?? backgroundTaskMessage);

            taskInfo.backgroundTaskHandle?.update({
                message: backgroundMessage,
                state: toBackgroundTaskState(taskProgressInfo.status),
                percent: currentPercent !== undefined ? Math.round(currentPercent) : undefined,
                canCancel:
                    taskInfo.taskInfo.isCancelable &&
                    taskProgressInfo.status !== TaskStatus.CancelRequested,
                cancel:
                    taskInfo.taskInfo.isCancelable &&
                    taskProgressInfo.status !== TaskStatus.CancelRequested
                        ? async () => {
                              await this.cancelTask(taskInfo.taskInfo.taskId);
                          }
                        : undefined,
            });
        }
    }

    private createBackgroundTaskTooltip(taskInfo: TaskInfo): string {
        const tooltipSections = [taskInfo.description];
        const connectionLabel = this.createBackgroundTaskDetails(taskInfo);
        if (connectionLabel) {
            tooltipSections.push(localizedConstants.backgroundTaskConnection(connectionLabel));
        }
        if (taskInfo.targetLocation) {
            tooltipSections.push(localizedConstants.backgroundTaskTarget(taskInfo.targetLocation));
        }
        return tooltipSections.filter(Boolean).join("\n\n");
    }

    private createBackgroundTaskDetails(taskInfo: TaskInfo): string | undefined {
        const connectionLabel = [taskInfo.serverName, taskInfo.databaseName]
            .filter((value) => Boolean(value))
            .join("/");

        return connectionLabel || undefined;
    }

    private createBackgroundTaskOpenHandler(
        taskInfo: TaskInfo,
        handler: TaskCompletionHandler | undefined,
        targetLocation: string | undefined,
    ): (() => Thenable<void>) | undefined {
        if (
            !handler ||
            !targetLocation ||
            !handler.actionButtonText ||
            !handler.actionCommand ||
            !handler.getActionCommandArgs
        ) {
            return undefined;
        }

        return () =>
            Promise.resolve(
                this._vscodeWrapper.executeCommand(
                    handler.actionCommand!,
                    ...handler.getActionCommandArgs!(taskInfo, targetLocation),
                ),
            ).then(() => {});
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
    private showCompletionMessage(taskStatus: TaskStatus, message: string): void {
        if (taskStatus === TaskStatus.Failed) {
            void this._vscodeWrapper.showErrorMessage(message);
        } else if (
            taskStatus === TaskStatus.Canceled ||
            taskStatus === TaskStatus.SucceededWithWarning
        ) {
            void this._vscodeWrapper.showWarningMessage(message);
        } else {
            void this._vscodeWrapper.showInformationMessage(message);
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
        case TaskStatus.CancelRequested:
            return localizedConstants.canceling;
        case TaskStatus.NotStarted:
            return localizedConstants.notStarted;
        default:
            console.warn(`Don't have display string for task status ${taskStatus}`);
            return (<any>taskStatus).toString(); // Typescript warns that we can never get here because we've used all the enum values so cast to any
    }
}

function toBackgroundTaskState(taskStatus: TaskStatus): BackgroundTaskState {
    switch (taskStatus) {
        case TaskStatus.Canceled:
            return BackgroundTaskState.Canceled;
        case TaskStatus.Failed:
            return BackgroundTaskState.Failed;
        case TaskStatus.Succeeded:
            return BackgroundTaskState.Succeeded;
        case TaskStatus.SucceededWithWarning:
            return BackgroundTaskState.SucceededWithWarning;
        case TaskStatus.CancelRequested:
            return BackgroundTaskState.Canceling;
        case TaskStatus.NotStarted:
            return BackgroundTaskState.NotStarted;
        case TaskStatus.InProgress:
        default:
            return BackgroundTaskState.InProgress;
    }
}
