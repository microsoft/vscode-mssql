/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants as loc } from "../../common/locConstants";
import { RouteDefinition, RouteMatch, createRouter } from "../../common/navigation/router";

export type PerformanceDashboardRouteId = "overview" | "queries" | "query" | "comparePlans";

export interface PerformanceDashboardRoute extends RouteDefinition {
    readonly id: PerformanceDashboardRouteId;
    /** Shown as a tab. */
    readonly tab?: boolean;
}

/** A section of the settings dialog. */
export type SettingsSection = "queryStore";

const settingsSections: readonly SettingsSection[] = ["queryStore"];

/**
 * The query value that opens the settings dialog over any page, at a section. For example
 * `overview?settings=queryStore`.
 */
const settingsParameter = "settings";

/** The settings section that the location opens, if any. */
export function settingsSectionOf(match: RouteMatch): SettingsSection | undefined {
    const section = match.query[settingsParameter];
    return settingsSections.find((candidate) => candidate === section);
}

/** The query values of a location without the settings dialog. */
export function pageQuery(match: RouteMatch): Record<string, string> {
    return Object.fromEntries(
        Object.entries(match.query).filter(([key]) => key !== settingsParameter),
    );
}

/** The location of the same page with the settings dialog open at a section, or closed. */
export function withSettings(match: RouteMatch, section: SettingsSection | undefined): string {
    return performanceDashboardRouter.build(match.route.id, match.params, {
        ...pageQuery(match),
        [settingsParameter]: section,
    });
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
        tab: true,
        title: () => loc.performanceDashboard.overview,
    },
    {
        id: "queries",
        path: "queries",
        tab: true,
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
];

export const performanceDashboardRouter = createRouter(routes, "overview");

/** The tabs of the dashboard, in table order. */
export const performanceDashboardTabs: readonly PerformanceDashboardRoute[] = routes.filter(
    (route) => route.tab,
);
