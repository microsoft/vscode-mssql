/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../sharedInterfaces/executionPlan";
import { RequestType } from "vscode-languageclient";

export interface GetExecutionPlanParams {
    graphInfo: ep.ExecutionPlanGraphInfo;
}

export namespace GetExecutionPlanRequest {
    export const type = new RequestType<GetExecutionPlanParams, ep.GetExecutionPlanResult, void>(
        "queryExecutionPlan/getExecutionPlan",
    );
}

export interface ExecutionPlanComparisonParams {
    firstExecutionPlanGraphInfo: ep.ExecutionPlanGraphInfo;
    secondExecutionPlanGraphInfo: ep.ExecutionPlanGraphInfo;
}

export namespace ExecutionPlanComparisonRequest {
    export const type = new RequestType<
        ExecutionPlanComparisonParams,
        ep.ExecutionPlanComparisonResult,
        void
    >("queryExecutionPlan/compareExecutionPlanGraph");
}

export interface GetLiveExecutionPlanParams {
    /** URI of the editor whose connection is running the query. */
    ownerUri: string;
    /** Server session id (SPID) running the query. */
    sessionId: number;
}

/**
 * Reads the in-flight plan of a running query, with the actual row counts so far. SQL Tools
 * Service reuses one monitoring connection per editor for every read.
 */
export namespace GetLiveExecutionPlanRequest {
    export const type = new RequestType<
        GetLiveExecutionPlanParams,
        ep.GetExecutionPlanResult,
        void
    >("queryExecutionPlan/getLiveExecutionPlan");
}

/** Closes the monitoring connection that live execution plan reads opened. */
export namespace EndLiveExecutionPlanRequest {
    export const type = new RequestType<{ ownerUri: string }, boolean, void>(
        "queryExecutionPlan/endLiveExecutionPlan",
    );
}
