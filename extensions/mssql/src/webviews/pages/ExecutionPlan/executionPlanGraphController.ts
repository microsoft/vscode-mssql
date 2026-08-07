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
    zoomIn(): void;
    zoomOut(): void;
    zoomToFit(): void;
    getZoomLevel(): number;
    setZoomLevel(level: number): void;
    searchNodes(searchQuery: SearchQuery): ExecutionPlanNode[];
    centerElement(element: InternalExecutionPlanElement): void;
    selectElement(element: InternalExecutionPlanElement | undefined, bringToCenter?: boolean): void;
    clearExpensiveOperatorHighlighting(): void;
    highlightExpensiveOperator(
        predicate: (node: ExecutionPlanMetricSource) => number | undefined,
    ): string | undefined;
}
