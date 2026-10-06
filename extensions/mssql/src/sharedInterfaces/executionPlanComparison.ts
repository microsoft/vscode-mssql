/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc";
import { ExecutionPlanGraph, ExecutionPlanGraphInfo } from "./executionPlan";

/**
 * The comparison editor shares no state with the extension. The webview owns what it shows and
 * talks to the extension only through the requests and notifications below.
 */
export type ExecutionPlanComparisonWebviewState = Record<string, never>;
export type ExecutionPlanComparisonReducers = Record<string, never>;

/** A plan file or query-result plan loaded into one side of a comparison. */
export interface ExecutionPlanComparisonSource {
    /** Display name of the plan file or query. */
    name: string;
    graphs: ExecutionPlanGraph[];
}

/** The plan the comparison editor was opened from. */
export interface ExecutionPlanComparisonInitialSource extends ExecutionPlanComparisonSource {
    /** Statement to show first. */
    graphIndex: number;
}

/** A node in one compared graph that has a match in the other graph. */
export interface ExecutionPlanComparisonMatch {
    /** Id of the node, as reported by the tools service. */
    nodeId: string;
    /** Similar area the node belongs to. Matching areas share it across both graphs. */
    groupIndex: number;
    /** Ids of the matching nodes in the other graph. */
    matchingNodeIds: string[];
}

export interface CompareExecutionPlanGraphsParams {
    primary: ExecutionPlanGraphInfo;
    secondary: ExecutionPlanGraphInfo;
}

/**
 * Matched nodes of both graphs, in pre-order. The tools service response repeats every subtree
 * under each of its nodes, so only these matches cross into the webview.
 */
export interface CompareExecutionPlanGraphsResult {
    primary: ExecutionPlanComparisonMatch[];
    secondary: ExecutionPlanComparisonMatch[];
}

export namespace GetInitialComparisonSourceRequest {
    export const type = new RequestType<void, ExecutionPlanComparisonInitialSource, void>(
        "executionPlanComparison/getInitialSource",
    );
}

/**
 * Lets the user pick an open plan or a plan file, and loads it. Resolves to nothing when the user
 * cancels, and fails with a displayable message when the plan cannot be loaded.
 */
export namespace PickComparisonSourceRequest {
    export const type = new RequestType<void, ExecutionPlanComparisonSource | undefined, void>(
        "executionPlanComparison/pickSource",
    );
}

/** Fails with a displayable message when the tools service cannot compare the graphs. */
export namespace CompareExecutionPlanGraphsRequest {
    export const type = new RequestType<
        CompareExecutionPlanGraphsParams,
        CompareExecutionPlanGraphsResult,
        void
    >("executionPlanComparison/compareGraphs");
}

/** Opens a query, such as a missing index script, in a new editor without running it. */
export namespace ShowComparisonQueryNotification {
    export const type = new NotificationType<{ query: string }>(
        "executionPlanComparison/showQuery",
    );
}
