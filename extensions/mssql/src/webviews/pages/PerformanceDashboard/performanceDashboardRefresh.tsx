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
    useRef,
    useState,
} from "react";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { clearExtensionRequestCache } from "../../common/useExtensionRequest";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

interface RefreshContextValue {
    /** Increases when the user refreshes. Reads include it in their key, so they read again. */
    readonly refreshKey: number;
    /** When the data of the current view was read: the time that its range ends at. */
    readonly updatedAt: Date;
    refresh(): void;
    /**
     * The time that a range ends at, the same for every view of the database with that range
     * until the user refreshes. So a view that opens again reads the same window, and its reads
     * come from the cache.
     */
    nowFor(anchorKey: string): Date;
}

const RefreshContext = createContext<RefreshContextValue>({
    refreshKey: 0,
    updatedAt: new Date(),
    refresh: () => undefined,
    nowFor: () => new Date(),
});

/** The query values of a location that set its time range. */
export const timeRangeKeys: ReadonlySet<string> = new Set(["range", "from", "to"]);

/** The key of the time anchor of a database and a location's time range. */
export function timeAnchorKey(
    databaseName: string,
    query: Readonly<Record<string, string | undefined>>,
): string {
    return [databaseName, ...[...timeRangeKeys].map((key) => query[key] ?? "")].join("|");
}

/** Gives the page a refresh key, the time anchors of its ranges, and the time of the last read. */
export const PerformanceDashboardRefreshProvider = ({ children }: { children: ReactNode }) => {
    const { match } = useNavigation();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const [refreshKey, setRefreshKey] = useState(0);
    // The anchors of this refresh. A refresh starts new ones, and drops the cached reads.
    const anchors = useRef(new Map<string, Date>());

    const nowFor = useCallback((anchorKey: string) => {
        let now = anchors.current.get(anchorKey);
        if (!now) {
            now = new Date();
            anchors.current.set(anchorKey, now);
        }
        return now;
    }, []);
    const refresh = useCallback(() => {
        clearExtensionRequestCache();
        anchors.current = new Map();
        setRefreshKey((key) => key + 1);
    }, []);

    const updatedAt = nowFor(timeAnchorKey(databaseName, match.query));
    const value = useMemo(
        () => ({ refreshKey, updatedAt, refresh, nowFor }),
        [refreshKey, updatedAt, refresh, nowFor],
    );
    return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
};

export function useRefresh(): RefreshContextValue {
    return useContext(RefreshContext);
}

/** The refresh interval of live views. */
export const livePollingMs = 15_000;

/**
 * A number that increases every `intervalMs` while the page is visible. Live views include it in
 * their read key, so they read again.
 */
export function usePolling(intervalMs: number = livePollingMs): number {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") {
                setTick((value) => value + 1);
            }
        }, intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return tick;
}
