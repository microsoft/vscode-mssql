/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import { GetExecutionPlanRequest, GetExecutionPlanParams } from "../models/contracts/executionPlan";
import { logger as baseLogger } from "../models/logger";
import * as ep from "../sharedInterfaces/executionPlan";

const logger = baseLogger.withPrefix("ExecutionPlanService");

export class ExecutionPlanService implements ep.ExecutionPlanService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async getExecutionPlan(
        planFile: ep.ExecutionPlanGraphInfo,
    ): Promise<ep.GetExecutionPlanResult> {
        try {
            let params: GetExecutionPlanParams = {
                graphInfo: planFile,
            };
            return await this._sqlToolsClient.sendRequest(GetExecutionPlanRequest.type, params);
        } catch (e) {
            logger.error("Failed to get execution plan", e);
            throw e;
        }
    }
}
