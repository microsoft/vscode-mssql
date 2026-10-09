/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants as loc } from "../../common/locConstants";
import { RouteDefinition, RouteMatch, createRouter } from "../../common/navigation/router";

export type PerformanceDashboardRouteId =
    | "overview"
    | "queries"
    | "query"
    | "comparePlans"
    | "activity"
    | "session"
    | "changes"
    | "setup";

export interface PerformanceDashboardRoute extends RouteDefinition {
    readonly id: PerformanceDashboardRouteId;
}

/** The plan IDs of a plan compare location, from `plans=4,9`. */
export function comparedPlanIds(match: RouteMatch): string[] {
    return (match.query.plans ?? "")
        .split(",")
        .map((planId) => planId.trim())
        .filter((planId) => planId.length > 0);
}

const routes: readonly PerformanceDashboardRoute[] = [
    {
        id: "overview",
        path: "overview",
        title: () => loc.performanceDashboard.overview,
    },
    {
        id: "queries",
        path: "queries",
        title: () => loc.performanceDashboard.queries,
    },
    {
        id: "query",
        path: "queries/:queryId",
        parent: "queries",
        title: (match) => loc.performanceDashboard.query(match.params.queryId),
    },
    {
        id: "comparePlans",
        path: "queries/:queryId/compare",
        parent: "query",
        title: (match) => {
            const planIds = comparedPlanIds(match);
            return planIds.length === 2
                ? loc.performanceDashboard.comparePlanPair(planIds[0], planIds[1])
                : loc.performanceDashboard.comparePlans;
        },
    },
    {
        id: "activity",
        path: "activity",
        title: () => loc.performanceDashboard.liveActivity,
    },
    {
        id: "session",
        path: "activity/:sessionId",
        parent: "activity",
        title: (match) => loc.performanceDashboard.session(match.params.sessionId),
    },
    {
        id: "changes",
        path: "changes",
        title: () => loc.performanceDashboard.changes,
    },
    {
        id: "setup",
        path: "setup",
        title: () => loc.performanceDashboard.setup,
    },
];

export const performanceDashboardRouter = createRouter(routes, "overview");

/** The tabs of the dashboard: the routes without a parent, in table order. */
export const performanceDashboardTabs: readonly PerformanceDashboardRoute[] = routes.filter(
    (route) => route.parent === undefined,
);
