/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    ExecutionPlanComparisonParams,
    ExecutionPlanComparisonRequest,
    GetExecutionPlanRequest,
    GetExecutionPlanParams,
} from "../models/contracts/executionPlan";
import { getLogger } from "../models/logger";
import * as ep from "../sharedInterfaces/executionPlan";
import { addExecutionPlanStatistics } from "../queryResult/liveExecutionPlanStatistics";

const logger = getLogger("ExecutionPlanService");

export class ExecutionPlanService implements ep.ExecutionPlanService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async getExecutionPlan(
        planFile: ep.ExecutionPlanGraphInfo,
    ): Promise<ep.GetExecutionPlanResult> {
        try {
            let params: GetExecutionPlanParams = {
                graphInfo: planFile,
            };
            const result = await this._sqlToolsClient.sendRequest(
                GetExecutionPlanRequest.type,
                params,
            );
            return {
                ...result,
                graphs: result.graphs.map((graph, index) => {
                    // Both query results and opened .sqlplan files use this service. Enrich actual
                    // plans here so their counters don't disappear when they replace a live read.
                    const source = {
                        ...graph,
                        graphFile: { ...planFile, planIndexInFile: index, ...graph.graphFile },
                    };
                    const annotated = addExecutionPlanStatistics(source);
                    return annotated === source ? graph : annotated;
                }),
            };
        } catch (e) {
            logger.error("Failed to get execution plan", e);
            throw e;
        }
    }

    async compareExecutionPlanGraph(
        firstPlanFile: ep.ExecutionPlanGraphInfo,
        secondPlanFile: ep.ExecutionPlanGraphInfo,
    ): Promise<ep.ExecutionPlanComparisonResult> {
        try {
            const params: ExecutionPlanComparisonParams = {
                firstExecutionPlanGraphInfo: firstPlanFile,
                secondExecutionPlanGraphInfo: secondPlanFile,
            };
            return await this._sqlToolsClient.sendRequest(
                ExecutionPlanComparisonRequest.type,
                params,
            );
        } catch (e) {
            logger.error("Failed to compare execution plans", e);
            throw e;
        }
    }
}
