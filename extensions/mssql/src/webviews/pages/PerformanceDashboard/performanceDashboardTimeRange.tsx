/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import {
    GetQueryStoreAvailabilityRequest,
    TimeWindowParams,
} from "../../../sharedInterfaces/performanceDashboard";
import { useNavigation } from "../../common/navigation/navigationProvider";
import {
    ResolvedTimeRange,
    TimeRangePreset,
    TimeRangeValue,
    resolveTimeRange,
    timeRangeFromQuery,
    timeRangeToQuery,
} from "../../common/timeRange/timeRange";
import { TimeRangePicker } from "../../common/timeRange/timeRangePicker";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import {
    defaultOverviewTimeRangeId,
    overviewTimeRangePresets,
} from "./performanceDashboardOverviewModel";
import { useRefresh } from "./performanceDashboardRefresh";
import {
    PerformanceDashboardRoute,
    PerformanceDashboardRouteId,
} from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

/** The views that have a time range. Each view keeps its own range in its location. */
export const timeRangeRoutes: ReadonlySet<PerformanceDashboardRouteId> = new Set([
    "overview",
    "queries",
    "query",
]);

const timeRangeKeys = new Set(["range", "from", "to"]);

export interface ViewTimeRange {
    readonly presets: readonly TimeRangePreset[];
    readonly value: TimeRangeValue;
    /** The range at the time of the last navigation or refresh. */
    readonly range: ResolvedTimeRange;
    readonly window: TimeWindowParams;
    /** The time that the range ends at for a preset. Reads use it, so they cover the same range. */
    readonly now: Date;
}

/**
 * The time range values of a location, for a link to a query page, so that the page opens with
 * the same range. The page keeps its own range after that.
 */
export function queryLinkRange(query: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(Object.entries(query).filter(([key]) => timeRangeKeys.has(key)));
}

/** The time range of the current view. */
export function useViewTimeRange(): ViewTimeRange {
    const { match } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const now = useMemo(() => new Date(), [match.location, databaseName, refreshKey]);
    const presets = overviewTimeRangePresets();
    const value = timeRangeFromQuery(match.query, presets, defaultOverviewTimeRangeId);
    const range = resolveTimeRange(value, presets, now);
    return {
        presets,
        value,
        range,
        window: { startUtc: range.from.toISOString(), endUtc: range.to.toISOString() },
        now,
    };
}

/** The oldest Query Store data, for the time range picker and averages. */
export function useQueryStoreAvailableFrom(): Date | undefined {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const availability = useExtensionRequest(GetQueryStoreAvailabilityRequest.type, undefined, [
        databaseName,
        refreshKey,
    ]);
    const oldest = availability.result?.oldestIntervalStartUtc;
    return oldest ? new Date(oldest) : undefined;
}

/**
 * The time range picker of the current view. It keeps the range in the view's location, with the
 * view's other values, and shows the available range from the oldest Query Store interval.
 */
export const PerformanceDashboardTimeRange = () => {
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { presets, value } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    return (
        <TimeRangePicker
            presets={presets}
            value={value}
            availableFrom={availableFrom}
            onChange={(next) => {
                const query = Object.fromEntries(
                    Object.entries(match.query).filter(([key]) => !timeRangeKeys.has(key)),
                );
                navigate(
                    router.build(match.route.id, match.params, {
                        ...query,
                        ...timeRangeToQuery(next, defaultOverviewTimeRangeId),
                    }),
                );
            }}
        />
    );
};
