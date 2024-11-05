/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage, getUniqueFilePath } from "../utils/utils";
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
import { sendActionEvent } from "../telemetry/telemetry";
import { sqlPlanLanguageId } from "../constants/constants";
import { executionPlanFileFilter } from "../constants/locConstants";

export async function saveExecutionPlan(
    state: QueryResultWebviewState | ExecutionPlanWebviewState,
    payload: ExecutionPlanReducers["saveExecutionPlan"],
) {
    let folder = vscode.Uri.file(homedir());

    // Show a save dialog to the user
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: await getUniqueFilePath(folder, `plan`, sqlPlanLanguageId),
        filters: {
            [executionPlanFileFilter]: [`.${sqlPlanLanguageId}`],
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
            graphFileType: `.${sqlPlanLanguageId}`,
        };
        try {
            newState.executionPlanGraphs = newState.executionPlanGraphs.concat(
                (await executionPlanService.getExecutionPlan(planFile)).graphs,
            );
            newState.loadState = ApiStatus.Loaded;

            sendActionEvent(
                TelemetryViews.ExecutionPlan,
                TelemetryActions.OpenExecutionPlan,
                {},
                {
                    numberOfPlans:
                        state.executionPlanState.executionPlanGraphs.length,
                    loadTimeInMs: performance.now() - startTime,
                },
            );
        } catch (e) {
            // malformed xml
            newState.loadState = ApiStatus.Error;
            newState.errorMessage = getErrorMessage(e);
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
    try {
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
    } catch {
        return xmlContents;
    }
}
