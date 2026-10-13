/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExpensiveMetricType,
    ExecutionPlanNode,
    InternalExecutionPlanElement,
    SearchQuery,
} from "../../../sharedInterfaces/executionPlan";
import { ExecutionPlanViewport } from "./executionPlanViewport";

export interface ExecutionPlanMetricSource {
    cost: number;
    subTreeCost: number;
    elapsedTimeInMs: number;
    costMetrics: {
        name: string;
        value: number | undefined;
    }[];
}

export interface ExecutionPlanGraphController {
    readonly expensiveMetricTypes: ReadonlySet<ExpensiveMetricType>;
    getRoot(): ExecutionPlanNode;
    getTotalRelativeCost(): number;
    getUniqueElementProperties(): string[];
    getSelectedElement(): InternalExecutionPlanElement | undefined;
    getElementById(id: string): InternalExecutionPlanElement | undefined;
    toggleTooltip(): boolean;
    setTooltipsEnabled(enabled: boolean): void;
    zoomIn(): void;
    zoomOut(): void;
    zoomToFit(): void;
    getZoomLevel(): number;
    setZoomLevel(level: number): void;
    searchNodes(searchQuery: SearchQuery): ExecutionPlanNode[];
    centerElement(element: InternalExecutionPlanElement): void;
    getViewport(): ExecutionPlanViewport;
    /** Moves the view at once, without animating. */
    setViewport(viewport: ExecutionPlanViewport): void;
    /** Whether an element is on the canvas and not hidden under a panel drawn over it. */
    isElementInView(element: InternalExecutionPlanElement): boolean;
    /** The center of an element, in the plan's own coordinates. */
    getElementCenter(element: InternalExecutionPlanElement): { x: number; y: number } | undefined;
    /** Centers the view on a point in the plan's own coordinates, keeping the zoom. */
    centerAt(point: { x: number; y: number }): void;
    /** Centers an element that is out of view, and leaves the view alone when it is in view. */
    revealElement(element: InternalExecutionPlanElement): void;
    /** Focus defaults to true; comparison synchronization keeps focus in the originating pane. */
    selectElement(
        element: InternalExecutionPlanElement | undefined,
        bringToCenter?: boolean,
        focus?: boolean,
    ): void;
    clearExpensiveOperatorHighlighting(): void;
    highlightExpensiveOperator(
        predicate: (node: ExecutionPlanMetricSource) => number | undefined,
    ): string | undefined;
}
