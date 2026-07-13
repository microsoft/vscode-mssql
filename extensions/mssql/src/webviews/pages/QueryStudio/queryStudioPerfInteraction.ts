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
    | "resultStackUnavailable"
    | "gridUnavailable"
    | "viewportUnavailable"
    | "notScrollable";

interface QueryStudioPerfGridController {
    scroll: (
        axis: "vertical" | "horizontal",
        target: QsPerfScrollTarget,
    ) => QueryStudioPerfInteractionOutcome;
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

/**
 * Drive relative, product-owned result scrolling without screen coordinates
 * or caller-provided selectors. The notification contract is PERF_MODE-only;
 * this renderer helper still accepts only its closed action union.
 */
export function performQueryStudioPerfInteraction(
    action: QsPerfInteractionAction,
    resultStack: HTMLElement | null,
): QueryStudioPerfInteractionOutcome {
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
    return performRegisteredQueryStudioPerfGridScroll(gridId, action.axis, action.target);
}
