/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QsPerfInteractionAction,
    QsPerfScrollTarget,
} from "../../../sharedInterfaces/queryStudio";

export type QueryStudioPerfInteractionOutcome =
    | "applied"
    | "alreadySelected"
    | "resultStackUnavailable"
    | "gridUnavailable"
    | "viewportUnavailable"
    | "selectionUnavailable"
    | "copyTooLarge"
    | "copyEmpty"
    | "notScrollable";

interface QueryStudioPerfGridController {
    scroll: (
        axis: "vertical" | "horizontal",
        target: QsPerfScrollTarget,
    ) => QueryStudioPerfInteractionOutcome;
    selectAll?: () => Promise<QueryStudioPerfInteractionOutcome>;
    copyAll?: (includeHeaders: boolean) => Promise<QueryStudioPerfInteractionOutcome>;
}

const gridControllers = new Map<string, QueryStudioPerfGridController>();

/**
 * Register the product-owned controller for one mounted Query Studio grid.
 * The identity check in the disposer makes this safe under React strict-mode
 * mount/unmount cycles and result-set replacement.
 */
export function registerQueryStudioPerfGridController(
    resultSetId: string,
    controller: QueryStudioPerfGridController,
): () => void {
    gridControllers.set(resultSetId, controller);
    return () => {
        if (gridControllers.get(resultSetId) === controller) {
            gridControllers.delete(resultSetId);
        }
    };
}

export function performRegisteredQueryStudioPerfGridScroll(
    resultSetId: string,
    axis: "vertical" | "horizontal",
    target: QsPerfScrollTarget,
): QueryStudioPerfInteractionOutcome {
    return gridControllers.get(resultSetId)?.scroll(axis, target) ?? "viewportUnavailable";
}

export function performRegisteredQueryStudioPerfGridSelection(
    resultSetId: string,
): Promise<QueryStudioPerfInteractionOutcome> {
    return (
        gridControllers.get(resultSetId)?.selectAll?.() ?? Promise.resolve("selectionUnavailable")
    );
}

export function performRegisteredQueryStudioPerfGridCopy(
    resultSetId: string,
    includeHeaders: boolean,
): Promise<QueryStudioPerfInteractionOutcome> {
    return (
        gridControllers.get(resultSetId)?.copyAll?.(includeHeaders) ??
        Promise.resolve("selectionUnavailable")
    );
}

export function queryStudioPerfScrollOffset(
    scrollSize: number,
    clientSize: number,
    target: QsPerfScrollTarget,
): number {
    const maximum = Math.max(0, scrollSize - clientSize);
    switch (target) {
        case "start":
            return 0;
        case "middle":
            return Math.round(maximum / 2);
        case "end":
            return maximum;
    }
}

export function queryStudioPerfSweepOffsets(
    scrollSize: number,
    clientSize: number,
    steps: number,
): number[] {
    const maximum = Math.max(0, scrollSize - clientSize);
    const boundedSteps = Math.max(2, Math.min(64, Math.floor(steps)));
    return Array.from({ length: boundedSteps }, (_value, index) =>
        Math.round((maximum * (index + 1)) / boundedSteps),
    );
}

function waitForQueryStudioPerfPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * Drive relative, product-owned result scrolling without screen coordinates
 * or caller-provided selectors. The notification contract is PERF_MODE-only;
 * this renderer helper still accepts only its closed action union.
 */
export async function performQueryStudioPerfInteraction(
    action: QsPerfInteractionAction,
    resultStack: HTMLElement | null,
): Promise<QueryStudioPerfInteractionOutcome> {
    if (action.kind === "sweepResultStack") {
        if (!resultStack) {
            return "resultStackUnavailable";
        }
        const offsets = queryStudioPerfSweepOffsets(
            resultStack.scrollHeight,
            resultStack.clientHeight,
            action.steps,
        );
        if (offsets.at(-1) === 0) {
            return "notScrollable";
        }
        for (const offset of offsets) {
            resultStack.scrollTop = offset;
            resultStack.dispatchEvent(new Event("scroll", { bubbles: true }));
            // IntersectionObserver/grid mount work settles between paints;
            // this PERF_MODE-only sweep must visit each region, not teleport.
            await waitForQueryStudioPerfPaint();
        }
        return "applied";
    }

    if (action.kind === "scrollResultStack") {
        if (!resultStack) {
            return "resultStackUnavailable";
        }
        const target = queryStudioPerfScrollOffset(
            resultStack.scrollHeight,
            resultStack.clientHeight,
            action.target,
        );
        if (
            target === resultStack.scrollTop &&
            resultStack.scrollHeight <= resultStack.clientHeight
        ) {
            return "notScrollable";
        }
        resultStack.scrollTop = target;
        resultStack.dispatchEvent(new Event("scroll", { bubbles: true }));
        return "applied";
    }

    const grids = document.querySelectorAll<HTMLElement>(
        "#qs-results-panel-results [data-fluent-result-grid='true']",
    );
    const grid = grids.item(action.resultSetIndex);
    if (!grid) {
        return "gridUnavailable";
    }
    const gridId = grid.dataset.gridId;
    if (!gridId) {
        return "viewportUnavailable";
    }
    if (action.kind === "selectGrid") {
        return performRegisteredQueryStudioPerfGridSelection(gridId);
    }
    if (action.kind === "copyGrid") {
        return performRegisteredQueryStudioPerfGridCopy(gridId, action.includeHeaders);
    }
    return performRegisteredQueryStudioPerfGridScroll(gridId, action.axis, action.target);
}
