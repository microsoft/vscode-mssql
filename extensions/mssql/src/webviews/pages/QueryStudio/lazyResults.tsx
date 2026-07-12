/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Staged loading for the heavy result surfaces (BOOT-2, QS_BOOTSTRAP_PERF
 * plan): the entry chunk carries Monaco + the shell ONLY.
 *
 * - P1 (known-need): the grid stack (results/resultsGrid → slickgrid) loads
 *   via dynamic import, PREFETCHED on the first idle moment after the
 *   editor is interactive — by the time a query returns, the chunk is
 *   almost always resident; if results beat it, Suspense shows a light
 *   placeholder for the few ms the local chunk takes.
 * - P2 (on-use): the execution-plan surface (azdataGraph, ~2 MB) loads ONLY
 *   when a plan tab is activated. Future heavy tabs (spatial, vector — see
 *   coding-docs/query-result-tabs) follow this exact pattern: cheap
 *   `appliesTo` sniffing in the shell, `loader: () => import(...)` on
 *   first activation.
 *
 * The bundle-budget test (queryStudioBundleBudget.test.ts) fails the suite
 * if any of these modules re-enter the entry's static closure.
 */

import * as React from "react";
import { perfMark } from "../../common/perfMarks";
import {
    queryPlanResultPaneContribution,
    spatialResultPaneContribution,
    vectorResultPaneContribution,
} from "./resultPaneRegistry";

const resultsModule = () => import("./results");
const gridModule = () => import("./resultsGrid");
const planModule = () => queryPlanResultPaneContribution.load();
const vectorModule = () => vectorResultPaneContribution.load();
const spatialModule = () => spatialResultPaneContribution.load();

let gridPrefetchStarted = false;
let gridLoaded = false;
let renderWaitedForChunk = false;

/** P1 prefetch: kicked once, on idle, after boot.editorInteractive. */
export function prefetchGridStack(): void {
    if (gridPrefetchStarted) {
        return;
    }
    gridPrefetchStarted = true;
    const kick = () => {
        perfMark("mssql.queryStudio.boot.gridChunkRequested", {});
        void Promise.all([resultsModule(), gridModule()]).then(() => {
            gridLoaded = true;
            perfMark("mssql.queryStudio.boot.gridChunkLoaded", {
                waitedForByRender: renderWaitedForChunk,
            });
        });
    };
    const idle = (
        globalThis as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
        }
    ).requestIdleCallback;
    if (idle) {
        idle(kick, { timeout: 1_000 });
    } else {
        setTimeout(kick, 50);
    }
}

/** True once the grid chunk is resident (render never suspends then). */
export function gridStackLoaded(): boolean {
    return gridLoaded;
}

/**
 * Resolves when the grid stack is resident (starts the load if nothing
 * has). resultsRendered honesty rides this: with a lazy grid the mark must
 * wait for the REAL grid paint, never the Suspense placeholder's.
 */
export async function whenGridStackLoaded(): Promise<void> {
    if (gridLoaded) {
        return;
    }
    prefetchGridStack();
    await Promise.all([resultsModule(), gridModule()]);
}

export const LazyResultGridBlock = React.lazy(async () => ({
    default: (await resultsModule()).ResultGridBlock,
}));

export const LazyMessagesView = React.lazy(async () => ({
    default: (await resultsModule()).MessagesView,
}));

export const LazyQsResultsGridProvider = React.lazy(async () => ({
    default: (await gridModule()).QsResultsGridProvider,
}));

export const LazyExecutionPlanView = React.lazy(async () => {
    const module = await planModule();
    perfMark("mssql.queryStudio.boot.planChunkLoaded", {});
    return {
        default: (module as typeof import("./queryPlanTab")).QueryStudioExecutionPlanView,
    };
});

export const LazyVectorTab = React.lazy(async () => {
    // P2 on-use (VEC-5): the Vector Workbench chunk loads only on first tab
    // activation — an unopened tab costs nothing beyond the appliesTo sniff.
    perfMark("mssql.queryStudio.boot.vectorChunkRequested", {});
    const module = await vectorModule();
    perfMark("mssql.queryStudio.boot.vectorChunkLoaded", {});
    return { default: (module as typeof import("./vectorTab")).VectorWorkbenchTab };
});

export const LazySpatialTab = React.lazy(async () => {
    perfMark("mssql.queryStudio.boot.spatialChunkRequested", {});
    const module = await spatialModule();
    perfMark("mssql.queryStudio.boot.spatialChunkLoaded", {});
    return { default: (module as typeof import("./spatialTab")).SpatialResultsPane };
});

/** Suspense fallback for the few-ms window where results beat the chunk. */
export function ResultsSurfaceLoading(): React.JSX.Element {
    // Results needed the chunk before the idle prefetch finished — the
    // gridChunkLoaded mark carries this honesty fact when it fires.
    renderWaitedForChunk = true;
    // Make sure the load is actually in flight (render can precede the
    // idle-prefetch kick when autoRun results land very fast).
    if (!gridPrefetchStarted) {
        prefetchGridStack();
    }
    return <div className="qs-muted qs-results-surface-loading">Loading results view…</div>;
}
