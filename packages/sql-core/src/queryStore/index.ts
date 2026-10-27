/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from "./metrics";
export * from "./capabilities";
export {
    type QueryStoreOverview,
    type QueryStoreReadOnlyReason,
    type QueryStoreReadOptions,
    type QueryStoreResult,
    type QueryStoreState,
    type QueryStoreStatus,
    type TimeWindow,
    getQueryStoreOverview,
} from "./state";
export {
    type QueryHistoryRequest,
    type QueryStoreInterval,
    type QueryStorePlanIntervalStats,
    combineRuntimeStats,
    getQueryHistory,
    historyBucketMinutes,
} from "./runtimeStats";
export * from "./queries";
export {
    type QueryPlansRequest,
    type QueryStorePlan,
    type QueryStorePlanForcingType,
    type QueryStorePlanInfo,
    type QueryStorePlanType,
    getPlanXml,
    getQueryPlans,
} from "./plans";
export * from "./planForcing";
export * from "./settings";
export * from "./waitStats";
export * from "./planSummary";
export * from "./analysis";
