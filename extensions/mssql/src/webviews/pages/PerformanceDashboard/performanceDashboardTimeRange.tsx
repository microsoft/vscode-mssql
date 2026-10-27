/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    GetQueryStoreOverviewRequest,
    TimeWindowParams,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
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
import { readData } from "./performanceDashboardParts";
import { timeAnchorKey, useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRouteId } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

/** The views that show the time range picker. They all read the dashboard's one range. */
export const timeRangeRoutes: ReadonlySet<PerformanceDashboardRouteId> = new Set([
    "queries",
    "query",
]);

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

export const defaultTimeRangeId = "24h";

/** The time range presets. Labels are read when called, so they are localized. */
export function timeRangePresets(): TimeRangePreset[] {
    const text = loc.performanceDashboard;
    return [
        { id: "1h", durationMs: hourMs, label: text.pastHour },
        { id: "12h", durationMs: 12 * hourMs, label: text.past12Hours },
        { id: "24h", durationMs: dayMs, label: text.past24Hours },
        { id: "7d", durationMs: 7 * dayMs, label: text.past7Days },
        { id: "30d", durationMs: 30 * dayMs, label: text.past30Days },
    ];
}

interface TimeRangeContextValue {
    readonly value: TimeRangeValue;
    setValue(value: TimeRangeValue): void;
}

const TimeRangeContext = createContext<TimeRangeContextValue>({
    value: { kind: "preset", presetId: defaultTimeRangeId },
    setValue: () => undefined,
});

/** The query values of a location that hold a time range. */
const timeRangeKeys: readonly string[] = ["range", "from", "to"];

function withoutTimeRange(query: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(query).filter(([key]) => !timeRangeKeys.includes(key)),
    );
}

function sameTimeRange(left: TimeRangeValue, right: TimeRangeValue): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Holds the time range of the dashboard, so that it stays the same as the user moves between the
 * queries and a query. The location holds the range too, for example `queries?range=7d`, so the
 * dashboard opens again with it and a link can set it: a location with a range sets it, and a
 * location without one, such as a breadcrumb's, gets the current range.
 */
export const PerformanceDashboardTimeRangeProvider = ({ children }: { children: ReactNode }) => {
    const { router, match, navigate } = useNavigation();
    const [value, setRangeValue] = useState<TimeRangeValue>(() =>
        timeRangeFromQuery(match.query, timeRangePresets(), defaultTimeRangeId),
    );

    useEffect(() => {
        if (timeRangeKeys.some((key) => match.query[key] !== undefined)) {
            const incoming = timeRangeFromQuery(
                match.query,
                timeRangePresets(),
                defaultTimeRangeId,
            );
            setRangeValue((current) => (sameTimeRange(current, incoming) ? current : incoming));
            return;
        }
        const rangeQuery = timeRangeToQuery(value, defaultTimeRangeId);
        if (Object.values(rangeQuery).some((part) => part !== undefined)) {
            navigate(router.build(match.route.id, match.params, { ...match.query, ...rangeQuery }));
        }
    }, [match, value, navigate, router]);

    // The range and the location change together, so the location never holds an older range.
    const setValue = useCallback(
        (next: TimeRangeValue) => {
            setRangeValue(next);
            navigate(
                router.build(match.route.id, match.params, {
                    ...withoutTimeRange(match.query),
                    ...timeRangeToQuery(next, defaultTimeRangeId),
                }),
            );
        },
        [match, navigate, router],
    );
    const context = useMemo(() => ({ value, setValue }), [value, setValue]);
    return <TimeRangeContext.Provider value={context}>{children}</TimeRangeContext.Provider>;
};

/** The time range of the dashboard, and a way to change it. */
export function useTimeRangeValue(): TimeRangeContextValue {
    return useContext(TimeRangeContext);
}

export interface ViewTimeRange {
    readonly presets: readonly TimeRangePreset[];
    readonly value: TimeRangeValue;
    /** The range at the time of the last change or refresh. */
    readonly range: ResolvedTimeRange;
    readonly window: TimeWindowParams;
    /** The time that the range ends at for a preset. Reads use it, so they cover the same range. */
    readonly now: Date;
}

/** The time range of the current view. */
export function useViewTimeRange(): ViewTimeRange {
    const { value } = useTimeRangeValue();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { nowFor } = useRefresh();
    // One "now" for the range and the database until a refresh, shared by the views, so that a
    // view that opens again reads the same window and gets its data from the cache.
    const now = nowFor(timeAnchorKey(databaseName, value));
    return useMemo(() => {
        const presets = timeRangePresets();
        const range = resolveTimeRange(value, presets, now);
        return {
            presets,
            value,
            range,
            window: { startUtc: range.from.toISOString(), endUtc: range.to.toISOString() },
            now,
        };
    }, [value, now]);
}

/** The oldest Query Store data, for the time range picker and averages. */
export function useQueryStoreAvailableFrom(): Date | undefined {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const overview = useExtensionRequest(GetQueryStoreOverviewRequest.type, undefined, [
        databaseName,
        refreshKey,
    ]);
    const oldest = readData(overview)?.oldestIntervalStartUtc;
    return useMemo(() => (oldest ? new Date(oldest) : undefined), [oldest]);
}

/** The time range picker of the dashboard, with the available range from the oldest interval. */
export const PerformanceDashboardTimeRange = () => {
    const { setValue } = useTimeRangeValue();
    const { presets, value } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    return (
        <TimeRangePicker
            presets={presets}
            value={value}
            availableFrom={availableFrom}
            onChange={setValue}
        />
    );
};
