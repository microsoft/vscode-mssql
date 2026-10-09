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
import { useNavigation } from "../../common/navigation/navigationProvider";

interface RefreshContextValue {
    /** Increases when the user refreshes. Reads include it in their key, so they read again. */
    readonly refreshKey: number;
    /** When the page last read its data: the last refresh or navigation. */
    readonly updatedAt: Date;
    refresh(): void;
}

const RefreshContext = createContext<RefreshContextValue>({
    refreshKey: 0,
    updatedAt: new Date(),
    refresh: () => undefined,
});

/** Gives the page a refresh key and the time of the last update. */
export const PerformanceDashboardRefreshProvider = ({ children }: { children: ReactNode }) => {
    const { match } = useNavigation();
    const [refreshKey, setRefreshKey] = useState(0);
    const [updatedAt, setUpdatedAt] = useState(() => new Date());

    useEffect(() => {
        setUpdatedAt(new Date());
    }, [match.location, refreshKey]);

    const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
    const value = useMemo(
        () => ({ refreshKey, updatedAt, refresh }),
        [refreshKey, updatedAt, refresh],
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
