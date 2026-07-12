/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight result-pane contribution registry (SPA-1). It contains only
 * lifecycle/layout metadata and dynamic loader thunks; heavy implementations
 * cannot enter the Query Studio bootstrap closure through this module.
 */

import type { QueryStudioTabId } from "../../../sharedInterfaces/queryStudioViewState";

export interface QueryStudioResultPaneContribution {
    readonly id: Exclude<QueryStudioTabId, "results" | "messages">;
    readonly order: number;
    readonly fillRegion: boolean;
    readonly keepMounted: boolean;
    readonly deactivate: "suspend" | "keepActive";
    readonly load: () => Promise<unknown>;
}

export const vectorResultPaneContribution = {
    id: "vector",
    order: 200,
    fillRegion: true,
    keepMounted: true,
    deactivate: "suspend",
    load: () => import("./vectorTab"),
} as const satisfies QueryStudioResultPaneContribution;

export const spatialResultPaneContribution = {
    id: "spatial",
    order: 300,
    fillRegion: true,
    keepMounted: true,
    deactivate: "suspend",
    load: () => import("./spatialTab"),
} as const satisfies QueryStudioResultPaneContribution;

export const queryPlanResultPaneContribution = {
    id: "queryPlan",
    order: 400,
    fillRegion: true,
    keepMounted: true,
    deactivate: "keepActive",
    load: () => import("./queryPlanTab"),
} as const satisfies QueryStudioResultPaneContribution;

export const QUERY_STUDIO_RESULT_PANE_CONTRIBUTIONS = [
    vectorResultPaneContribution,
    spatialResultPaneContribution,
    queryPlanResultPaneContribution,
] as const;
