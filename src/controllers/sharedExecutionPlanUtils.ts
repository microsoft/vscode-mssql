/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exists } from "../utils/utils";
import { homedir } from "os";
import {
    ExecutionPlanGraphInfo,
    ExecutionPlanReducers,
    ExecutionPlanWebviewState,
} from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { ExecutionPlanService } from "../services/executionPlanService";
import { QueryResultWebviewState } from "../sharedInterfaces/queryResult";
import * as vscode from "vscode";
import UntitledSqlDocumentService from "./untitledSqlDocumentService";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";

export async function saveExecutionPlan(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    payload: ExecutionPlanReducers["saveExecutionPlan"],
) {
    let folder = vscode.Uri.file(homedir());
    let filename: vscode.Uri;

    // make the default filename of the plan to be saved-
    // start at plan.sqlplan, then plan1.sqlplan, ...
    let counter = 1;
    if (await exists(`plan.sqlplan`, folder)) {
        while (await exists(`plan${counter}.sqlplan`, folder)) {
            counter += 1;
        }
        filename = vscode.Uri.joinPath(folder, `plan${counter}.sqlplan`);
    } else {
        filename = vscode.Uri.joinPath(folder, "plan.sqlplan");
    }

    // Show a save dialog to the user
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: filename,
        filters: {
            "SQL Plan Files": ["sqlplan"],
        },
    });

    if (saveUri) {
        // Write the content to the new file
        void vscode.workspace.fs.writeFile(
            saveUri,
            Buffer.from(payload.sqlPlanContent),
        );
    }

    return state;
}

export async function showPlanXml(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    payload: ExecutionPlanReducers["showPlanXml"],
) {
    const planXmlDoc = await vscode.workspace.openTextDocument({
        content: formatXml(payload.sqlPlanContent),
        language: "xml",
    });

    void vscode.window.showTextDocument(planXmlDoc);

    return state;
}

export async function showQuery(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    payload: ExecutionPlanReducers["showQuery"],
    untitledSqlDocumentService: UntitledSqlDocumentService,
) {
    void untitledSqlDocumentService.newQuery(payload.query);

    return state;
}

export async function updateTotalCost(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    payload: ExecutionPlanReducers["updateTotalCost"],
) {
    return {
        ...state,
        executionPlanState: {
            ...state.executionPlanState,
            totalCost: (state.executionPlanState.totalCost +=
                payload.addedCost),
        },
    };
}

export async function createExecutionPlanGraphs(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    executionPlanService: ExecutionPlanService,
    xmlPlans: string[],
) {
    let newState = {
        ...state.executionPlanState,
    };
    const startTime = performance.now(); // timer for telemetry
    for (const plan of xmlPlans) {
        const planFile: ExecutionPlanGraphInfo = {
            graphFileContent: plan,
            graphFileType: ".sqlplan",
        };
        try {
            newState.executionPlanGraphs = newState.executionPlanGraphs.concat(
                (await executionPlanService.getExecutionPlan(planFile)).graphs,
            );

            newState.loadState = ApiStatus.Loaded;

            sendActionEvent(
                TelemetryViews.QueryPlan,
                TelemetryActions.OpenQueryPlan,
                {},
                {
                    numberOfPlans:
                        state.executionPlanState.executionPlanGraphs.length,
                    LoadTimeInMs: performance.now() - startTime,
                },
            );
        } catch (e) {
            newState.loadState = ApiStatus.Error;
            newState.errorMessage = e.toString();
            sendErrorEvent(
                TelemetryViews.QueryPlan,
                TelemetryActions.OpenQueryPlan,
                e,
                true, // includeErrorMessage
            );
        }
    }
    state.executionPlanState = newState;
    state.executionPlanState.totalCost = calculateTotalCost(state);

    return state;
}

export function calculateTotalCost(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
): number {
    if (!state.executionPlanState.executionPlanGraphs) {
        state.executionPlanState.loadState = ApiStatus.Error;
        return 0;
    }

    let sum = 0;
    for (const graph of state.executionPlanState.executionPlanGraphs) {
        sum += graph.root.cost + graph.root.subTreeCost;
    }
    return sum;
}

export function formatXml(xmlContents: string): string {
    let formattedXml = "";
    let currentLevel = 0;

    const elements = xmlContents.match(/<[^>]*>/g);
    for (const element of elements) {
        if (element.startsWith("</")) {
            // Closing tag: decrement the level
            currentLevel--;
        }
        formattedXml += "\t".repeat(currentLevel) + element + "\n";
        if (
            element.startsWith("<") &&
            !element.startsWith("</") &&
            !element.endsWith("/>")
        ) {
            // Opening tag: increment the level
            currentLevel++;
        }
    }
    return formattedXml;
}
