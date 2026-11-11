/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pinned query results custom document (C2D-3, chat_to_data plan §10):
 * webview state + URI helpers for the readonly snapshot editor. The webview
 * reuses the Query Studio result-pane RPCs (`qs/getRows`, `qs/saveResult`,
 * `qs/openCellDocument`, `qs/openPlan`, `qs/getMessages`) against its own
 * controller — coarse state carries summaries only, never row values.
 */

import { QsGridStyle, QsResultSetSummary } from "./queryStudio";

export const PINNED_RESULTS_VIEW_TYPE = "mssql.queryResultsSnapshot";
export const PINNED_RESULTS_SCHEME = "mssql-query-results-snapshot";

export interface PinnedResultsState {
    kind: "queryResultsSnapshot";
    /** Snapshot missing/expired (reload after retention, stale tab restore). */
    expired: boolean;
    sourceTitle?: string;
    createdEpochMs?: number;
    resultSets: QsResultSetSummary[];
    totalRows: number;
    messageCount: number;
    errorCount: number;
    hasLocalMessages: boolean;
    gridStyle?: QsGridStyle;
    /**
     * SPA-10 / D-0024 (revised): pinned panes carry the SAME layer surface as
     * live Query Studio — offline world outline plus host-proxied online
     * sources. Consent, trust gating, tile cache, and fetch all live in the
     * shared extension-level basemap host; this controller only proxies.
     */
    spatialBasemapEnabled?: boolean;
    /** Bumped when basemap settings change so mounted panes re-fetch the layer list. */
    spatialBasemapEpoch?: number;
}

export function isPinnedResultsState(value: unknown): value is PinnedResultsState {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as PinnedResultsState).kind === "queryResultsSnapshot"
    );
}

/** `mssql-query-results-snapshot:/<title>.mssqlresults?sid=<snapshotId>` */
export function pinnedResultsUriParts(uri: { query: string }): { snapshotId: string } | undefined {
    const match = /(?:^|&)sid=([A-Za-z0-9_-]+)/.exec(uri.query);
    return match ? { snapshotId: match[1] } : undefined;
}
