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
    const viewports = [...grid.querySelectorAll<HTMLElement>(".slick-viewport")];
    if (viewports.length === 0) {
        return "viewportUnavailable";
    }
    const range = (viewport: HTMLElement) =>
        action.axis === "vertical"
            ? viewport.scrollHeight - viewport.clientHeight
            : viewport.scrollWidth - viewport.clientWidth;
    const viewport = viewports.reduce((best, candidate) =>
        range(candidate) > range(best) ? candidate : best,
    );
    if (range(viewport) <= 0) {
        return "notScrollable";
    }
    if (action.axis === "vertical") {
        viewport.scrollTop = queryStudioPerfScrollOffset(
            viewport.scrollHeight,
            viewport.clientHeight,
            action.target,
        );
    } else {
        viewport.scrollLeft = queryStudioPerfScrollOffset(
            viewport.scrollWidth,
            viewport.clientWidth,
            action.target,
        );
    }
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    return "applied";
}
