/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlDocumentService from "../controllers/sqlDocumentService";
import {
    createExecutionPlanGraphs,
    openExecutionPlanComparisonWebview,
} from "../controllers/sharedExecutionPlanUtils";
import { ExecutionPlanService } from "../services/executionPlanService";

export async function compareQueryStudioPlan(
    context: vscode.ExtensionContext,
    services:
        | { executionPlanService?: ExecutionPlanService; sqlDocumentService?: SqlDocumentService }
        | undefined,
    sqlPlanContent: string,
    name: string,
): Promise<void> {
    if (!services?.executionPlanService || !services.sqlDocumentService) {
        return;
    }
    const state = await createExecutionPlanGraphs(
        { executionPlanState: { executionPlanGraphs: [], totalCost: 0 } },
        services.executionPlanService,
        [sqlPlanContent],
        "QueryResults",
    );
    openExecutionPlanComparisonWebview(
        context,
        services.executionPlanService,
        services.sqlDocumentService,
        {
            primary: { name, graphs: state.executionPlanState.executionPlanGraphs, graphIndex: 0 },
        },
    );
}
