/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    GetFavoriteQueriesRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    SetFavoriteQueryRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import type { QueryGridFavorites } from "./performanceDashboardQueryGrid";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

/** The favorite queries of the dashboard's database, which the extension saves. */
export function useFavoriteQueries(): QueryGridFavorites {
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const [queryIds, setQueryIds] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        let current = true;
        void extensionRpc.sendRequest(GetFavoriteQueriesRequest.type).then((result) => {
            if (current) {
                setQueryIds(new Set(result.queryIds));
            }
        });
        return () => {
            current = false;
        };
    }, [extensionRpc, databaseName]);

    const toggle = useCallback(
        (queryId: string, favorite: boolean) => {
            // Show the change at once; the saved list replaces it.
            setQueryIds((current) => {
                const next = new Set(current);
                if (favorite) {
                    next.add(queryId);
                } else {
                    next.delete(queryId);
                }
                return next;
            });
            void extensionRpc
                .sendRequest(SetFavoriteQueryRequest.type, { queryId, favorite })
                .then((result) => setQueryIds(new Set(result.queryIds)));
        },
        [extensionRpc],
    );

    return useMemo(() => ({ queryIds, toggle }), [queryIds, toggle]);
}
