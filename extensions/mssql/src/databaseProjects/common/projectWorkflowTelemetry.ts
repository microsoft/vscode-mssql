/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    startWorkflow,
    type TelemetryEventProperties,
    type WorkflowTelemetryObject,
} from "extension-toolkit/vscode";
import * as path from "node:path";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";

export enum SqlProjectWorkflowEventName {
    ProjectCreated = "ProjectCreated",
    BuildStarted = "BuildStarted",
    BuildCompleted = "BuildCompleted",
    PublishDialogOpened = "PublishDialogOpened",
    PublishStarted = "PublishStarted",
    PublishCompleted = "PublishCompleted",
    PublishDialogClosed = "PublishDialogClosed",
}

interface SqlProjectWorkflowEventOptions {
    outcome?: string;
    additionalProps?: TelemetryEventProperties;
}

const SqlProjectWorkflowStep = {
    [SqlProjectWorkflowEventName.ProjectCreated]: { name: "New", ordinal: 1 },
    [SqlProjectWorkflowEventName.BuildStarted]: { name: "Build", ordinal: 2 },
    [SqlProjectWorkflowEventName.BuildCompleted]: { name: "Build", ordinal: 2 },
    [SqlProjectWorkflowEventName.PublishDialogOpened]: { name: "Publish", ordinal: 3 },
    [SqlProjectWorkflowEventName.PublishStarted]: { name: "Publish", ordinal: 3 },
    [SqlProjectWorkflowEventName.PublishCompleted]: { name: "Publish", ordinal: 3 },
    [SqlProjectWorkflowEventName.PublishDialogClosed]: { name: "Publish", ordinal: 3 },
} as const;

const workflows = new Map<string, WorkflowTelemetryObject>();
const maxTrackedWorkflows = 100;

function getProjectKey(projectFilePath: string): string {
    const normalizedPath = path.normalize(projectFilePath);
    return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
}

function getOrStartWorkflow(
    projectFilePath: string,
    eventName: SqlProjectWorkflowEventName,
    options: SqlProjectWorkflowEventOptions,
): { workflow: WorkflowTelemetryObject; started: boolean } {
    const key = getProjectKey(projectFilePath);
    const existing = workflows.get(key);
    if (existing) {
        return { workflow: existing, started: false };
    }

    if (workflows.size >= maxTrackedWorkflows) {
        const oldestKey = workflows.keys().next().value;
        if (oldestKey) {
            workflows.delete(oldestKey);
        }
    }

    const workflow = startWorkflow(
        TelemetryViews.SqlProjects,
        TelemetryActions.SqlProjectWorkflow,
        eventName,
        {
            step: SqlProjectWorkflowStep[eventName],
            outcome: options.outcome,
            commonProps: {
                workflowEntryPoint: SqlProjectWorkflowStep[eventName].name,
            },
            additionalProps: options.additionalProps,
        },
    );
    workflows.set(key, workflow);
    return { workflow, started: true };
}

export function recordSqlProjectWorkflowEvent(
    projectFilePath: string,
    eventName: SqlProjectWorkflowEventName,
    options: SqlProjectWorkflowEventOptions = {},
): void {
    const { workflow, started } = getOrStartWorkflow(projectFilePath, eventName, options);
    if (!started) {
        workflow.record(eventName, {
            step: SqlProjectWorkflowStep[eventName],
            outcome: options.outcome,
            additionalProps: options.additionalProps,
        });
    }
}

export function completeSqlProjectWorkflow(
    projectFilePath: string,
    eventName: SqlProjectWorkflowEventName,
    options: SqlProjectWorkflowEventOptions = {},
): void {
    const key = getProjectKey(projectFilePath);
    const workflow = workflows.get(key);
    if (!workflow) {
        getOrStartWorkflow(projectFilePath, eventName, options);
        workflows.delete(key);
        return;
    }
    workflow.end(eventName, {
        step: SqlProjectWorkflowStep[eventName],
        outcome: options.outcome,
        additionalProps: options.additionalProps,
    });
    workflows.delete(key);
}
