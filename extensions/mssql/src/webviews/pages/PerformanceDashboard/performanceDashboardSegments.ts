/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ComponentType } from "react";
import type { DatabaseFactsResult } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { PerformanceDashboardAutoIndexView } from "./performanceDashboardAutoIndexView";
import { PerformanceDashboardBlockedView } from "./performanceDashboardBlockedView";
import { PerformanceDashboardConnectionsView } from "./performanceDashboardConnectionsView";
import { metrics, queryMetricColumn } from "./performanceDashboardMetrics";
import {
    CpuQueryStorePanel,
    MemoryGrantPanel,
    PanelProps,
    RequestsPanel,
} from "./performanceDashboardPanels";
import { QueryListSpec } from "./performanceDashboardQueryListSection";
import { PerformanceDashboardStorageView } from "./performanceDashboardStorageView";

/*
 * The segments of the overview, as specs: what each shows and on which platforms. The overview
 * renders a spec as its panel (a summary and a chart) and its top queries, or as a view of its
 * own. To add or remove a segment, add or remove its spec.
 */

export type OverviewSegment =
    | "cpu"
    | "memory"
    | "connections"
    | "requests"
    | "blocked"
    | "storage"
    | "autoIndex";

export const overviewSegmentParameter = "metric";

export interface SegmentSpec {
    readonly id: OverviewSegment;
    readonly label: () => string;
    /** True when the platform has the data of the segment. */
    readonly available: (facts: DatabaseFactsResult | undefined) => boolean;
    /** The summary and chart, from the source that fits the platform. */
    readonly panel?: (facts: DatabaseFactsResult | undefined) => ComponentType<PanelProps>;
    /** The top queries below the panel. */
    readonly queryList?: QueryListSpec;
    /** A view of its own, in place of the panel and the top queries. */
    readonly view?: ComponentType<PanelProps>;
}

/**
 * The SQL engine with Query Store: SQL Server 2016 and later, Managed Instance, Azure SQL
 * Database, and SQL database in Fabric. Before the platform is known, the segments of the SQL
 * engine show.
 */
function hasQueryStore(facts: DatabaseFactsResult | undefined): boolean {
    switch (facts?.platform) {
        case undefined:
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        case "sqlServer":
            return facts.majorVersion === undefined || facts.majorVersion >= 13;
        default:
            return false;
    }
}

/** Azure SQL Database and SQL database in Fabric have resource stats of the database's limits. */
function hasResourceStats(facts: DatabaseFactsResult | undefined): boolean {
    return facts?.platform === "azureSqlDatabase" || facts?.platform === "fabricSqlDatabase";
}

function isSqlEngine(facts: DatabaseFactsResult | undefined): boolean {
    return hasQueryStore(facts) || facts?.platform === "sqlServer";
}

export const segmentSpecs: readonly SegmentSpec[] = [
    {
        id: "cpu",
        label: () => loc.performanceDashboard.cpuConsumption,
        available: hasQueryStore,
        panel: () => CpuQueryStorePanel,
        queryList: {
            title: () => loc.performanceDashboard.topQueriesByCpu,
            metric: "cpuTime",
            statistics: ["total", "avg"],
            category: "cpu",
            columns: (statistic) => [
                queryMetricColumn(metrics.cpuTime, {
                    id: "cpu",
                    statistic,
                    value: (row) => row.value,
                    share: (row) => row.share,
                    showShare: statistic === "total",
                }),
                queryMetricColumn(metrics.executions, {
                    id: "executions",
                    value: (row) => row.executions,
                }),
            ],
        },
    },
    {
        id: "memory",
        label: () => loc.performanceDashboard.memoryConsumption,
        available: hasQueryStore,
        panel: () => MemoryGrantPanel,
        queryList: {
            title: () => loc.performanceDashboard.topQueriesByMemory,
            metric: "memoryConsumption",
            statistics: ["total", "avg"],
            detailed: true,
            category: "memory",
            columns: (statistic) => [
                queryMetricColumn(metrics.memoryGrant, {
                    id: "memory",
                    statistic,
                    value: (row) => row.value,
                    share: (row) => row.share,
                    showShare: statistic === "total",
                }),
                // The tempdb space that queries used, spills included. A list by average has the
                // average, so the total is the average times the executions.
                queryMetricColumn(metrics.tempdbSpill, {
                    id: "spill",
                    statistic: "total",
                    value: (row) => {
                        const tempdb = row.metrics?.tempDbMemoryUsed;
                        if (tempdb === undefined) {
                            return undefined;
                        }
                        return statistic === "total" ? tempdb : tempdb * row.executions;
                    },
                }),
                queryMetricColumn(metrics.executions, {
                    id: "executions",
                    value: (row) => row.executions,
                }),
            ],
        },
    },
    {
        id: "connections",
        label: () => loc.performanceDashboard.liveConnections,
        available: (facts) => facts?.platform !== "unknown",
        view: PerformanceDashboardConnectionsView,
    },
    {
        id: "requests",
        label: () => loc.performanceDashboard.requests,
        // Query Store on Synapse dedicated pools records the execution counts too.
        available: (facts) => hasQueryStore(facts) || facts?.platform === "synapseDedicated",
        panel: () => RequestsPanel,
        queryList: {
            title: () => loc.performanceDashboard.mostFrequentQueries,
            metric: "executionCount",
            category: "executions",
            columns: () => [
                queryMetricColumn(metrics.executions, {
                    id: "executions",
                    value: (row) => row.executions,
                }),
            ],
        },
    },
    {
        id: "blocked",
        label: () => loc.performanceDashboard.blockedRequests,
        available: hasQueryStore,
        view: PerformanceDashboardBlockedView,
    },
    {
        id: "storage",
        label: () => loc.performanceDashboard.storage,
        available: isSqlEngine,
        view: PerformanceDashboardStorageView,
    },
    {
        id: "autoIndex",
        label: () => loc.performanceDashboard.automaticIndex,
        available: hasResourceStats,
        view: PerformanceDashboardAutoIndexView,
    },
];

/** The specs of the segments that the platform has, in order. */
export function overviewSegmentsFor(facts: DatabaseFactsResult | undefined): SegmentSpec[] {
    return segmentSpecs.filter((spec) => spec.available(facts));
}
