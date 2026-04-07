/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as localizedConstants from "../constants/locConstants";
import { uuid } from "../utils/utils";
import logger2 from "../models/logger2";

export enum BackgroundTaskState {
    NotStarted = 0,
    InProgress = 1,
    Succeeded = 2,
    SucceededWithWarning = 3,
    Failed = 4,
    Canceled = 5,
    Canceling = 6,
}

export type BackgroundTaskIcon =
    | vscode.ThemeIcon
    | vscode.Uri
    | { light: vscode.Uri; dark: vscode.Uri };

export interface BackgroundTaskRegistration {
    displayText: string;
    details?: string;
    tooltip: string | vscode.MarkdownString;
    icon?: BackgroundTaskIcon;
    percent?: number;
    canCancel?: boolean;
    cancel?: () => void | Thenable<void>;
    open?: () => void | Thenable<void>;
    source?: string;
    message?: string;
    state?: BackgroundTaskState;
}

export interface BackgroundTaskUpdate {
    displayText?: string;
    details?: string;
    tooltip?: string | vscode.MarkdownString;
    icon?: BackgroundTaskIcon;
    percent?: number;
    canCancel?: boolean;
    cancel?: (() => void | Thenable<void>) | undefined;
    open?: (() => void | Thenable<void>) | undefined;
    source?: string;
    message?: string;
    state?: BackgroundTaskState;
}

export interface BackgroundTaskHandle {
    readonly id: string;
    update(update: BackgroundTaskUpdate): void;
    complete(finalState: BackgroundTaskState, update?: BackgroundTaskUpdate): void;
    remove(): void;
}

export interface BackgroundTaskEntry {
    id: string;
    displayText: string;
    details?: string;
    tooltip: string | vscode.MarkdownString;
    icon?: BackgroundTaskIcon;
    percent?: number;
    canCancel: boolean;
    cancel?: () => void | Thenable<void>;
    open?: () => void | Thenable<void>;
    source?: string;
    message?: string;
    state: BackgroundTaskState;
    sequence: number;
    createdAt: number;
    completedAt?: number;
    updatedAt: number;
}

export const DEFAULT_MAX_FINISHED_BACKGROUND_TASKS = 25;

const logger = logger2.withPrefix("BackgroundTasksService");

export class BackgroundTasksService {
    private _tasks = new Map<string, BackgroundTaskEntry>();
    private _nextSequence = 0;

    constructor(
        private readonly _refreshCallback: () => void,
        private readonly _maxFinishedTasks: number = DEFAULT_MAX_FINISHED_BACKGROUND_TASKS,
        private readonly _revealCallback?: () => void,
    ) {}

    public registerTask(registration: BackgroundTaskRegistration): BackgroundTaskHandle {
        const id = uuid();
        const timestamp = Date.now();
        const entry: BackgroundTaskEntry = {
            id,
            displayText: registration.displayText,
            details: registration.details,
            tooltip: registration.tooltip,
            icon: registration.icon,
            percent: normalizePercent(registration.percent),
            canCancel: Boolean(registration.canCancel && registration.cancel),
            cancel: registration.cancel,
            open: registration.open,
            source: registration.source,
            message: registration.message,
            state: registration.state ?? BackgroundTaskState.InProgress,
            sequence: this._nextSequence++,
            createdAt: timestamp,
            completedAt: isBackgroundTaskCompleted(
                registration.state ?? BackgroundTaskState.InProgress,
            )
                ? timestamp
                : undefined,
            updatedAt: timestamp,
        };

        this._tasks.set(id, entry);
        this.trimFinishedTasks();
        this._refreshCallback();
        this._revealCallback?.();

        return {
            id,
            update: (update) => this.updateTask(id, update),
            complete: (finalState, update) => this.completeTask(id, finalState, update),
            remove: () => this.removeTask(id),
        };
    }

    public get tasks(): BackgroundTaskEntry[] {
        return [...this._tasks.values()].sort(compareTasks);
    }

    public clearFinished(): void {
        let changed = false;
        for (const [id, task] of this._tasks.entries()) {
            if (isBackgroundTaskCompleted(task.state)) {
                this._tasks.delete(id);
                changed = true;
            }
        }

        if (changed) {
            this._refreshCallback();
        }
    }

    public async openTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task?.open) {
            return;
        }

        await Promise.resolve(task.open());
    }

    public async cancelTask(taskId: string): Promise<void> {
        const task = this._tasks.get(taskId);
        if (!task || !task.cancel || !task.canCancel || isBackgroundTaskCompleted(task.state)) {
            return;
        }

        const previousState = task.state;
        const previousCanCancel = task.canCancel;
        const cancelCallback = task.cancel;

        this.updateTask(taskId, {
            state: BackgroundTaskState.Canceling,
            canCancel: false,
            cancel: undefined,
        });

        try {
            await Promise.resolve(cancelCallback());
        } catch (error) {
            const currentTask = this._tasks.get(taskId);
            if (currentTask) {
                currentTask.state = previousState;
                currentTask.canCancel = Boolean(previousCanCancel && cancelCallback);
                currentTask.cancel = cancelCallback;
                currentTask.updatedAt = Date.now();
                this.trimFinishedTasks();
                this._refreshCallback();
            }

            throw error;
        }
    }

    private updateTask(taskId: string, update: BackgroundTaskUpdate): void {
        const task = this._tasks.get(taskId);
        if (!task) {
            return;
        }

        applyTaskUpdate(task, update);
        task.updatedAt = Date.now();

        if (isBackgroundTaskCompleted(task.state)) {
            task.canCancel = false;
            task.cancel = undefined;
        } else if (!task.cancel) {
            task.canCancel = false;
        }

        this.trimFinishedTasks();
        this._refreshCallback();
    }

    private completeTask(
        taskId: string,
        finalState: BackgroundTaskState,
        update?: BackgroundTaskUpdate,
    ): void {
        const task = this._tasks.get(taskId);
        if (!task) {
            return;
        }

        if (update) {
            applyTaskUpdate(task, update);
        }

        task.state = finalState;
        task.canCancel = false;
        task.cancel = undefined;
        task.completedAt = Date.now();
        task.updatedAt = Date.now();

        this.trimFinishedTasks();
        this._refreshCallback();
    }

    private removeTask(taskId: string): void {
        if (this._tasks.delete(taskId)) {
            this._refreshCallback();
        }
    }

    private trimFinishedTasks(): void {
        const finishedTasks = [...this._tasks.values()]
            .filter((task) => isBackgroundTaskCompleted(task.state))
            .sort(
                (left, right) =>
                    (left.completedAt ?? left.updatedAt) - (right.completedAt ?? right.updatedAt),
            );

        const tasksToRemove = finishedTasks.slice(
            0,
            Math.max(0, finishedTasks.length - this._maxFinishedTasks),
        );

        for (const task of tasksToRemove) {
            this._tasks.delete(task.id);
        }
    }
}

export function isBackgroundTaskCompleted(state: BackgroundTaskState): boolean {
    return (
        state === BackgroundTaskState.Canceled ||
        state === BackgroundTaskState.Failed ||
        state === BackgroundTaskState.Succeeded ||
        state === BackgroundTaskState.SucceededWithWarning
    );
}

export function toBackgroundTaskStateDisplayString(state: BackgroundTaskState): string {
    switch (state) {
        case BackgroundTaskState.Canceled:
            return localizedConstants.canceled;
        case BackgroundTaskState.Failed:
            return localizedConstants.failed;
        case BackgroundTaskState.Succeeded:
            return localizedConstants.succeeded;
        case BackgroundTaskState.SucceededWithWarning:
            return localizedConstants.succeededWithWarning;
        case BackgroundTaskState.InProgress:
            return localizedConstants.inProgress;
        case BackgroundTaskState.Canceling:
            return localizedConstants.canceling;
        case BackgroundTaskState.NotStarted:
            return localizedConstants.notStarted;
        default:
            logger.warn(`Unexpected background task state: ${String(state)}`);
            return String(state);
    }
}

export function getBackgroundTaskElapsedTimeMs(
    task: BackgroundTaskEntry,
    now: number = Date.now(),
): number {
    const endTime = isBackgroundTaskCompleted(task.state)
        ? (task.completedAt ?? task.updatedAt)
        : now;

    return Math.max(0, endTime - task.createdAt);
}

/**
 * Sorts active tasks ahead of completed tasks.
 * Active tasks are ordered newest-first by registration sequence, and completed tasks are ordered
 * newest-first by completion time so the most relevant items stay closest to the top.
 */
function compareTasks(left: BackgroundTaskEntry, right: BackgroundTaskEntry): number {
    const leftCompleted = isBackgroundTaskCompleted(left.state);
    const rightCompleted = isBackgroundTaskCompleted(right.state);

    if (leftCompleted !== rightCompleted) {
        return leftCompleted ? 1 : -1;
    }

    if (!leftCompleted) {
        return right.sequence - left.sequence;
    }

    return (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt);
}

function normalizePercent(percent?: number): number | undefined {
    if (percent === undefined || Number.isNaN(percent)) {
        return undefined;
    }

    return Math.min(100, Math.max(0, Math.round(percent)));
}

function applyTaskUpdate(task: BackgroundTaskEntry, update: BackgroundTaskUpdate): void {
    if (Object.prototype.hasOwnProperty.call(update, "displayText") && update.displayText) {
        task.displayText = update.displayText;
    }

    if (Object.prototype.hasOwnProperty.call(update, "details")) {
        task.details = update.details;
    }

    if (Object.prototype.hasOwnProperty.call(update, "tooltip") && update.tooltip !== undefined) {
        task.tooltip = update.tooltip;
    }

    if (Object.prototype.hasOwnProperty.call(update, "icon")) {
        task.icon = update.icon;
    }

    if (Object.prototype.hasOwnProperty.call(update, "percent")) {
        task.percent = normalizePercent(update.percent);
    }

    if (Object.prototype.hasOwnProperty.call(update, "source")) {
        task.source = update.source;
    }

    if (Object.prototype.hasOwnProperty.call(update, "message")) {
        task.message = update.message;
    }

    if (Object.prototype.hasOwnProperty.call(update, "state") && update.state !== undefined) {
        task.state = update.state;
    }

    if (Object.prototype.hasOwnProperty.call(update, "cancel")) {
        task.cancel = update.cancel;
    }

    if (Object.prototype.hasOwnProperty.call(update, "open")) {
        task.open = update.open;
    }

    if (Object.prototype.hasOwnProperty.call(update, "canCancel")) {
        task.canCancel = Boolean(update.canCancel && task.cancel);
    }
}
