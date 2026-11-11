/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants as loc } from "../../common/locConstants";
import { RouteDefinition, RouteMatch, createRouter } from "../../common/navigation/router";

export type PerformanceDashboardRouteId = "queries" | "query";

export interface PerformanceDashboardRoute extends RouteDefinition {
    readonly id: PerformanceDashboardRouteId;
    /** Shown as a tab. */
    readonly tab?: boolean;
}

/** A section of the settings dialog. */
export type SettingsSection = "queryStore";

/**
 * False hides the Query Store settings for now: the toolbar button, the links to them, and the
 * location that opens them. The settings and their requests stay, to show them again later.
 */
export const showQueryStoreSettings = false;

const settingsSections: readonly SettingsSection[] = ["queryStore"];

/**
 * The query value that opens the settings dialog over any page, at a section. For example
 * `queries?settings=queryStore`.
 */
const settingsParameter = "settings";

/** The settings section that the location opens, if any. */
export function settingsSectionOf(match: RouteMatch): SettingsSection | undefined {
    const section = match.query[settingsParameter];
    return showQueryStoreSettings
        ? settingsSections.find((candidate) => candidate === section)
        : undefined;
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

const routes: readonly PerformanceDashboardRoute[] = [
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
];

export const performanceDashboardRouter = createRouter(routes, "queries");

/** The tabs of the dashboard, in table order. */
export const performanceDashboardTabs: readonly PerformanceDashboardRoute[] = routes.filter(
    (route) => route.tab,
);
