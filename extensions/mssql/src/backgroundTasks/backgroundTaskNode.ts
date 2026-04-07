/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as localizedConstants from "../constants/locConstants";
import { IconUtils } from "../utils/iconUtils";
import {
    BackgroundTaskEntry,
    BackgroundTaskState,
    getBackgroundTaskElapsedTimeMs,
    isBackgroundTaskCompleted,
    toBackgroundTaskStateDisplayString,
} from "./backgroundTasksService";

export class EmptyBackgroundTaskNode extends vscode.TreeItem {
    public static readonly contextValue = "emptyBackgroundTaskNode";

    constructor() {
        super(localizedConstants.noBackgroundTasks, vscode.TreeItemCollapsibleState.None);
        this.contextValue = EmptyBackgroundTaskNode.contextValue;
    }
}

export class BackgroundTaskNode extends vscode.TreeItem {
    public readonly taskId: string;

    constructor(task: BackgroundTaskEntry) {
        super(task.displayText, vscode.TreeItemCollapsibleState.None);
        this.taskId = task.id;
        this.description = createTaskDescription(task);
        this.tooltip = createTaskTooltip(task);
        this.iconPath = task.icon ?? getDefaultIconForState(task.state);
        this.contextValue = createTaskContextValue(task);

        if (task.open) {
            this.command = {
                command: Constants.cmdBackgroundTaskAction,
                title: "",
                arguments: [this],
            };
        }
    }
}

function createTaskDescription(task: BackgroundTaskEntry): string | undefined {
    const sections: string[] = [];
    if (task.percent !== undefined) {
        sections.push(`${task.percent}%`);
    }
    if (task.details) {
        sections.push(task.details);
    }
    sections.push(formatElapsedTime(task));
    return sections.length > 0 ? sections.join(" | ") : undefined;
}

function createTaskContextValue(task: BackgroundTaskEntry): string {
    return [
        "backgroundTaskNode",
        `actionable=${Boolean(task.open)}`,
        `cancelable=${Boolean(task.canCancel && task.cancel && !isBackgroundTaskCompleted(task.state))}`,
        `completed=${isBackgroundTaskCompleted(task.state)}`,
    ].join(",");
}

function createTaskTooltip(task: BackgroundTaskEntry): string | vscode.MarkdownString {
    const status = toBackgroundTaskStateDisplayString(task.state);
    const elapsedTime = localizedConstants.backgroundTaskElapsedTime(formatElapsedTime(task));

    if (typeof task.tooltip === "string") {
        const sections = [task.tooltip, status];
        if (task.message) {
            sections.push(task.message);
        }
        if (task.source) {
            sections.push(localizedConstants.backgroundTaskSource(task.source));
        }
        sections.push(elapsedTime);
        return sections.join(`${os.EOL}${os.EOL}`);
    }

    const tooltip = new vscode.MarkdownString(task.tooltip.value, task.tooltip.supportThemeIcons);
    tooltip.isTrusted = task.tooltip.isTrusted;
    tooltip.supportHtml = task.tooltip.supportHtml;
    tooltip.supportThemeIcons = task.tooltip.supportThemeIcons;
    tooltip.baseUri = task.tooltip.baseUri;
    tooltip.appendMarkdown(`\n\n${escapeMarkdown(status)}`);

    if (task.message) {
        tooltip.appendMarkdown(`\n\n${escapeMarkdown(task.message)}`);
    }

    if (task.source) {
        tooltip.appendMarkdown(
            `\n\n${escapeMarkdown(localizedConstants.backgroundTaskSource(task.source))}`,
        );
    }

    tooltip.appendMarkdown(`\n\n${escapeMarkdown(elapsedTime)}`);

    return tooltip;
}

function formatElapsedTime(task: BackgroundTaskEntry): string {
    const elapsedTimeMs = getBackgroundTaskElapsedTimeMs(task);

    if (elapsedTimeMs < 1000) {
        return localizedConstants.backgroundTaskElapsedMilliseconds(elapsedTimeMs);
    }

    const totalSeconds = Math.floor(elapsedTimeMs / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);

    if (days > 0) {
        return localizedConstants.backgroundTaskElapsedDaysAndHours(days, hours);
    }

    if (totalHours > 0) {
        return localizedConstants.backgroundTaskElapsedHoursAndMinutes(totalHours, minutes);
    }

    if (totalMinutes > 0) {
        return localizedConstants.backgroundTaskElapsedMinutesAndSeconds(totalMinutes, seconds);
    }

    return localizedConstants.backgroundTaskElapsedSeconds(totalSeconds);
}

function getDefaultIconForState(
    state: BackgroundTaskState,
): vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } {
    switch (state) {
        case BackgroundTaskState.Succeeded:
            return IconUtils.getIcon("backgroundTasks", "completedTask.svg");
        case BackgroundTaskState.SucceededWithWarning:
            return new vscode.ThemeIcon("warning");
        case BackgroundTaskState.Failed:
            return IconUtils.getIcon("backgroundTasks", "failedTask.svg");
        case BackgroundTaskState.Canceled:
            return new vscode.ThemeIcon("circle-slash");
        case BackgroundTaskState.Canceling:
            return new vscode.ThemeIcon("debug-pause");
        case BackgroundTaskState.NotStarted:
            return new vscode.ThemeIcon("clock");
        case BackgroundTaskState.InProgress:
        default:
            return new vscode.ThemeIcon("sync~spin");
    }
}

function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
