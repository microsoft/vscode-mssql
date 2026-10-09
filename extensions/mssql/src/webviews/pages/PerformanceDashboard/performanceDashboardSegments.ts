/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SqlPlatform } from "../../../sharedInterfaces/performance";
import { locConstants as loc } from "../../common/locConstants";

/** The segments of the overview, in display order. */
export type OverviewSegment =
    | "cpu"
    | "memory"
    | "connections"
    | "requests"
    | "blocked"
    | "autoIndex";

export const overviewSegments: readonly OverviewSegment[] = [
    "cpu",
    "memory",
    "connections",
    "requests",
    "blocked",
    "autoIndex",
];

/** The query value of the overview location that selects a segment, for example `metric=memory`. */
export const overviewSegmentParameter = "metric";

/**
 * The segments that the platform has data for. A segment without data on the platform is left
 * out. Without the platform (it could not be read), the segments of the SQL engines.
 */
export function overviewSegmentsFor(
    platform: SqlPlatform | undefined,
    majorVersion?: number,
): OverviewSegment[] {
    const sqlEngine =
        platform === "azureSqlManagedInstance" ||
        platform === "azureSqlDatabase" ||
        platform === "fabricSqlDatabase" ||
        (platform === "sqlServer" && (majorVersion === undefined || majorVersion >= 13));
    const supported = new Set<OverviewSegment>();
    if (sqlEngine || platform === undefined) {
        supported.add("cpu").add("memory").add("requests").add("blocked");
    }
    if (platform === "synapseDedicated") {
        // Query Store on Synapse dedicated pools records only duration and execution count.
        supported.add("requests");
    }
    if (platform !== "unknown") {
        supported.add("connections");
    }
    if (platform === "azureSqlDatabase" || platform === "fabricSqlDatabase") {
        supported.add("autoIndex");
    }
    return overviewSegments.filter((segment) => supported.has(segment));
}

export function overviewSegmentLabel(segment: OverviewSegment): string {
    const text = loc.performanceDashboard;
    switch (segment) {
        case "cpu":
            return text.cpu;
        case "memory":
            return text.memory;
        case "connections":
            return text.liveConnections;
        case "requests":
            return text.requests;
        case "blocked":
            return text.blockedRequests;
        default:
            return text.automaticIndex;
    }
}
