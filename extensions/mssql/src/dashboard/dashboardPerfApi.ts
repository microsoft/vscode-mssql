/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";

const scenarios = new Set<SqlDashboard.MockScenario>([
    "canonical",
    "lowPermission",
    "queryStoreOff",
    "disconnected",
    "queryVolume500",
    "queryVolume5000",
]);

export type DashboardPerfRouteAlias =
    | "server"
    | "database"
    | "performance"
    | "query-regressed"
    | "live"
    | "agent";

export interface DashboardPerfOpenArgs {
    scenario?: SqlDashboard.MockScenario;
    route?: DashboardPerfRouteAlias;
}

export function parseDashboardPerfArgs(
    value: unknown,
    fixtureDatabase: string,
): { scenario: SqlDashboard.MockScenario; route: SqlDashboard.Route } {
    if (
        value !== undefined &&
        (value === null || typeof value !== "object" || Array.isArray(value))
    ) {
        throw new TypeError("SQL Dashboard performance arguments must be an object");
    }
    const args = (value ?? {}) as { scenario?: unknown; route?: unknown };
    const scenario = args.scenario ?? "canonical";
    if (typeof scenario !== "string" || !scenarios.has(scenario as SqlDashboard.MockScenario)) {
        throw new TypeError("SQL Dashboard performance scenario is not allowlisted");
    }
    const route = args.route ?? "server";
    if (
        typeof route !== "string" ||
        !["server", "database", "performance", "query-regressed", "live", "agent"].includes(route)
    ) {
        throw new TypeError("SQL Dashboard performance route is not allowlisted");
    }
    return {
        scenario: scenario as SqlDashboard.MockScenario,
        route: routeFromAlias(route as DashboardPerfRouteAlias, fixtureDatabase),
    };
}

export function routeFromAlias(
    alias: DashboardPerfRouteAlias,
    fixtureDatabase: string,
): SqlDashboard.Route {
    switch (alias) {
        case "server":
            return { kind: "serverOverview" };
        case "database":
            return { kind: "databaseOverview", database: fixtureDatabase };
        case "performance":
            return { kind: "databasePerformance", database: fixtureDatabase };
        case "query-regressed":
            return { kind: "queryDetail", database: fixtureDatabase, queryId: "42" };
        case "live":
            return { kind: "liveActivity", database: fixtureDatabase };
        case "agent":
            return { kind: "agent" };
    }
}
