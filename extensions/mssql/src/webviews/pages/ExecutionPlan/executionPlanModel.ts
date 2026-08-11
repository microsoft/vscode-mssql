/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExpensiveMetricType,
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
    ExecutionPlanNode,
    InternalExecutionPlanEdge,
    InternalExecutionPlanElement,
    SearchQuery,
    SearchType,
} from "../../../sharedInterfaces/executionPlan";
import { locConstants } from "../../common/locConstants";

export const EXECUTION_PLAN_NODE_WIDTH = 80;
export const EXECUTION_PLAN_NODE_HEIGHT = 80;
export const EXECUTION_PLAN_MINIMUM_RANK_WIDTH = 80;
export const EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH = 200;
export const EXECUTION_PLAN_RANK_PADDING = 40;
export const EXECUTION_PLAN_MINIMUM_ROW_SPACING = 105;
export const EXECUTION_PLAN_GRAPH_PADDING = 25;

export interface ExecutionPlanEdgeModel extends InternalExecutionPlanEdge {
    id: string;
    sourceId: string;
    targetId: string;
    weight: number;
}

export interface ExecutionPlanNodePosition {
    x: number;
    y: number;
}

export type ExecutionPlanNodePositions = ReadonlyMap<string, ExecutionPlanNodePosition>;

type TextMeasurer = (text: string) => number;

function cloneProperty(
    property: ExecutionPlanGraphElementProperty,
): ExecutionPlanGraphElementProperty {
    return {
        ...property,
        value: Array.isArray(property.value)
            ? property.value.map((child) => cloneProperty(child))
            : property.value,
    };
}

function normalizeElementId(id: string, fallback: string): string {
    const candidate = id || fallback;
    return candidate.startsWith("element-") ? candidate : `element-${candidate}`;
}

export function getExecutionPlanEdgeWeight(rowCount: number): number {
    if (rowCount <= 0) {
        return 0.5;
    }
    return Math.max(0.5, Math.min(0.5 + 0.75 * Math.log10(rowCount), 6));
}

function metricValue(node: ExecutionPlanNode, names: string[]): number | undefined {
    const metric = node.costMetrics.find((candidate) => names.includes(candidate.name));
    if (metric?.value === undefined) {
        return undefined;
    }
    const value = Number(metric.value);
    return Number.isNaN(value) ? undefined : value;
}

export function getExpensiveMetricValue(
    node: ExecutionPlanNode,
    metricType: ExpensiveMetricType,
): number | undefined {
    switch (metricType) {
        case ExpensiveMetricType.ActualElapsedTime:
            return node.elapsedTimeInMs;
        case ExpensiveMetricType.ActualElapsedCpuTime:
            return metricValue(node, ["ElapsedCpuTime"]);
        case ExpensiveMetricType.Cost:
            return node.cost;
        case ExpensiveMetricType.SubtreeCost:
            return node.subTreeCost;
        case ExpensiveMetricType.ActualNumberOfRowsForAllExecutions:
            return metricValue(node, ["ActualRows", "EstimateRowsAllExecs"]);
        case ExpensiveMetricType.NumberOfRowsRead:
            return metricValue(node, ["ActualRowsRead", "EstimatedRowsRead"]);
        case ExpensiveMetricType.Off:
            return undefined;
    }
}

/**
 * Immutable, renderer-neutral representation of an execution plan.
 */
export class ExecutionPlanModel {
    private readonly _root: ExecutionPlanNode;
    private readonly _rootSubtreeCost: number;
    private readonly _nodes = new Map<string, ExecutionPlanNode>();
    private readonly _edges = new Map<string, ExecutionPlanEdgeModel>();
    private readonly _parentIds = new Map<string, string>();
    private readonly _childIds = new Map<string, string[]>();
    private readonly _edgeIds = new Map<string, string[]>();
    private readonly _propertyNames = new Set<string>();
    private readonly _expensiveMetricTypes = new Set<ExpensiveMetricType>([
        ExpensiveMetricType.Off,
    ]);

    constructor(root: ExecutionPlanNode) {
        this._rootSubtreeCost = root.subTreeCost;
        this._root = this.normalizeNode(root, undefined, 0, "root");
    }

    public get root(): ExecutionPlanNode {
        return this._root;
    }

    public get expensiveMetricTypes(): ReadonlySet<ExpensiveMetricType> {
        return this._expensiveMetricTypes;
    }

    public get nodes(): readonly ExecutionPlanNode[] {
        return [...this._nodes.values()];
    }

    public get edges(): readonly ExecutionPlanEdgeModel[] {
        return [...this._edges.values()];
    }

    public getNode(id: string): ExecutionPlanNode | undefined {
        return this._nodes.get(id);
    }

    public getEdge(id: string): ExecutionPlanEdgeModel | undefined {
        return this._edges.get(id);
    }

    public getElement(id: string): InternalExecutionPlanElement | undefined {
        return this.getNode(id) ?? this.getEdge(id);
    }

    public getParentId(id: string): string | undefined {
        return this._parentIds.get(id);
    }

    public getChildIds(id: string): readonly string[] {
        return this._childIds.get(id) ?? [];
    }

    public getEdgeIds(id: string): readonly string[] {
        return this._edgeIds.get(id) ?? [];
    }

    public getUniqueElementProperties(): string[] {
        return [...this._propertyNames].sort();
    }

    public getTotalRelativeCost(): number {
        return this._root.cost + this._root.subTreeCost;
    }

    public searchNodes(searchQuery: SearchQuery): ExecutionPlanNode[] {
        return this.getTraversalNodes().filter((node) => {
            const property = node.properties.find(
                (candidate) => candidate.name === searchQuery.propertyName,
            );
            if (typeof property?.value !== "string") {
                return false;
            }

            switch (searchQuery.searchType) {
                case SearchType.Equals:
                    return property.value === searchQuery.value;
                case SearchType.Contains:
                    return property.value.includes(searchQuery.value);
                case SearchType.GreaterThan:
                    return property.value > searchQuery.value;
                case SearchType.LesserThan:
                    return property.value < searchQuery.value;
                case SearchType.GreaterThanEqualTo:
                    return property.value >= searchQuery.value;
                case SearchType.LesserThanEqualTo:
                    return property.value <= searchQuery.value;
                case SearchType.LesserAndGreaterThan:
                    return property.value < searchQuery.value || property.value > searchQuery.value;
            }
        });
    }

    public findMostExpensiveNode(
        getMetricValue: (node: ExecutionPlanNode) => number | undefined,
    ): ExecutionPlanNode | undefined {
        let result: ExecutionPlanNode | undefined;
        let maximum = Number.NEGATIVE_INFINITY;

        for (const node of this.getTraversalNodes()) {
            const value = getMetricValue(node);
            if (value !== undefined && value >= 0 && value > maximum) {
                maximum = value;
                result = node;
            }
        }
        return result;
    }

    public getAncestorIds(id: string): string[] {
        const result: string[] = [];
        let parentId = this.getParentId(id);
        while (parentId) {
            result.push(parentId);
            parentId = this.getParentId(parentId);
        }
        return result;
    }

    private normalizeNode(
        source: ExecutionPlanNode,
        parentId: string | undefined,
        siblingIndex: number,
        path: string,
    ): ExecutionPlanNode {
        let id = normalizeElementId(String(source.id ?? ""), path);
        if (this._nodes.has(id)) {
            id = `${id}-${path}`;
        }

        const properties = source.properties
            .filter(
                (property) =>
                    property.name !== locConstants.executionPlan.subtreeCostLabel &&
                    property.name !== locConstants.executionPlan.operatorCostLabel,
            )
            .map((property) => cloneProperty(property));

        properties.push({
            name: locConstants.executionPlan.subtreeCostLabel,
            value: source.subTreeCost.toString(),
            displayValue: source.subTreeCost.toString(),
            showInTooltip: true,
            displayOrder: 8,
            positionAtBottom: false,
            dataType: ExecutionPlanGraphElementPropertyDataType.Number,
            betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
        });
        this._propertyNames.add(locConstants.executionPlan.subtreeCostLabel);

        const operatorCost = source.relativeCost * this._rootSubtreeCost;
        properties.push({
            name: locConstants.executionPlan.operatorCostLabel,
            value: operatorCost.toString(),
            displayValue: `${parseFloat(operatorCost.toFixed(7)).toString()} (${source.costDisplayString})`,
            showInTooltip: true,
            displayOrder: 3,
            positionAtBottom: false,
            dataType: ExecutionPlanGraphElementPropertyDataType.Number,
            betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
        });
        this._propertyNames.add(locConstants.executionPlan.operatorCostLabel);

        const node: ExecutionPlanNode = {
            ...source,
            id,
            properties,
            badges: source.badges.map((badge) => ({ ...badge })),
            costMetrics: source.costMetrics.map((metric) => ({ ...metric })),
            children: [],
            edges: [],
        };

        this._nodes.set(id, node);
        if (parentId) {
            this._parentIds.set(id, parentId);
        }
        for (const property of source.properties) {
            this._propertyNames.add(property.name);
        }
        this.loadMetricTypes(node);

        node.children = source.children.map((child, index) =>
            this.normalizeNode(child, id, index, `${path}-${siblingIndex}-${index}`),
        );
        this._childIds.set(
            id,
            node.children.map((child) => child.id),
        );

        node.edges = (source.edges ?? []).map((edge, index) => {
            const targetId = node.children[index]?.id ?? `${id}-missing-child-${index}`;
            const edgeId = `element-edge-${id}-${targetId}-${index}`;
            const normalizedEdge: ExecutionPlanEdgeModel = {
                ...edge,
                id: edgeId,
                sourceId: id,
                targetId,
                weight: getExecutionPlanEdgeWeight(edge.rowCount),
                properties: edge.properties.map((property) => cloneProperty(property)),
            };
            this._edges.set(edgeId, normalizedEdge);
            for (const property of edge.properties) {
                this._propertyNames.add(property.name);
            }
            return normalizedEdge;
        });
        this._edgeIds.set(
            id,
            node.edges.map((edge) => (edge as ExecutionPlanEdgeModel).id),
        );

        return node;
    }

    private loadMetricTypes(node: ExecutionPlanNode): void {
        if (node.cost) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.Cost);
        }
        if (node.subTreeCost) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.SubtreeCost);
        }
        if (node.elapsedTimeInMs) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.ActualElapsedTime);
        }
        if (metricValue(node, ["ElapsedCpuTime"]) !== undefined) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.ActualElapsedCpuTime);
        }
        if (metricValue(node, ["ActualRows", "EstimateRowsAllExecs"]) !== undefined) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.ActualNumberOfRowsForAllExecutions);
        }
        if (metricValue(node, ["ActualRowsRead", "EstimatedRowsRead"]) !== undefined) {
            this._expensiveMetricTypes.add(ExpensiveMetricType.NumberOfRowsRead);
        }
    }

    private getTraversalNodes(): ExecutionPlanNode[] {
        const result: ExecutionPlanNode[] = [];
        const stack = [this._root];
        while (stack.length > 0) {
            const node = stack.pop()!;
            result.push(node);
            stack.push(...node.children);
        }
        return result;
    }
}

class LayoutFrontier {
    private readonly _points: { level: number; y: number }[] = [];

    public getY(level: number): number {
        let y = 0;
        for (const point of this._points) {
            if (level < point.level) {
                break;
            }
            y = Math.max(y, point.y);
        }
        return y;
    }

    public update(level: number, y: number): void {
        const existingIndex = this._points.findIndex((point) => point.level >= level);
        if (existingIndex === -1) {
            this._points.push({ level, y });
            return;
        }

        if (this._points[existingIndex].level === level) {
            this._points[existingIndex].y = Math.max(this._points[existingIndex].y, y);
        } else {
            this._points.splice(existingIndex, 0, { level, y });
        }

        const insertedIndex = this._points.findIndex((point) => point.level === level);
        const insertedY = this._points[insertedIndex].y;
        let endIndex = insertedIndex + 1;
        while (endIndex < this._points.length && this._points[endIndex].y <= insertedY) {
            endIndex++;
        }
        this._points.splice(insertedIndex + 1, endIndex - insertedIndex - 1);
    }
}

let measurementCanvas: HTMLCanvasElement | undefined;

function defaultMeasureText(text: string): number {
    if (typeof document === "undefined") {
        return text.length * 6;
    }
    measurementCanvas ??= document.createElement("canvas");
    const context = measurementCanvas.getContext("2d");
    if (!context) {
        return text.length * 6;
    }
    // azdataGraph does not set a font on its measurement canvas, whose default
    // is 10px sans-serif. Keep that behavior so horizontal spacing remains equal.
    context.font = "10px sans-serif";
    return context.measureText(text).width;
}

/**
 * Ports azdataGraph's execution-plan-specific layout so switching renderers does not rearrange
 * the plan.
 */
export function layoutExecutionPlan(
    model: ExecutionPlanModel,
    measureText: TextMeasurer = defaultMeasureText,
): ExecutionPlanNodePositions {
    const positions = new Map<string, ExecutionPlanNodePosition>();
    const levels = new Map<string, number>();
    const maximumChildLevels = new Map<string, number>();
    let rowSpacing = EXECUTION_PLAN_MINIMUM_ROW_SPACING;

    const label = (node: ExecutionPlanNode) => node.subtext.join("\n");
    const hasBranchingAncestor = (node: ExecutionPlanNode): boolean => {
        let current: ExecutionPlanNode | undefined = node;
        while (current) {
            if (current.children.length >= 2) {
                return true;
            }
            const parentId = model.getParentId(current.id);
            current = parentId ? model.getNode(parentId) : undefined;
        }
        return false;
    };

    const setX = (node: ExecutionPlanNode, x: number, level: number): number => {
        levels.set(node.id, level);
        positions.set(node.id, { x, y: 0 });
        rowSpacing = Math.max(rowSpacing, 45 + Math.max(1, node.subtext.length) * 10);

        const currentWidth = measureText(label(node));
        const maximumChildWidth = Math.max(
            0,
            ...node.children.map((child) => measureText(label(child))),
        );
        let spacing = currentWidth / 2 + maximumChildWidth / 2;
        if (node.children.length > 1 && hasBranchingAncestor(node)) {
            spacing += Math.max(maximumChildWidth - EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH, 0);
        }
        spacing = Math.max(spacing, EXECUTION_PLAN_MINIMUM_RANK_WIDTH);

        let maximumChildLevel = level;
        for (const child of node.children) {
            maximumChildLevel = Math.max(
                maximumChildLevel,
                setX(child, x + spacing + EXECUTION_PLAN_RANK_PADDING, level + 1),
            );
        }
        maximumChildLevels.set(node.id, maximumChildLevel);
        return maximumChildLevel;
    };

    setX(model.root, EXECUTION_PLAN_GRAPH_PADDING, 0);

    const frontier = new LayoutFrontier();
    const setY = (node: ExecutionPlanNode, requestedY: number): void => {
        const maximumChildLevel = maximumChildLevels.get(node.id) ?? levels.get(node.id) ?? 0;
        let y = Math.max(requestedY, frontier.getY(maximumChildLevel));
        positions.set(node.id, { x: positions.get(node.id)!.x, y });
        const nextY = y + rowSpacing;
        for (const child of node.children) {
            setY(child, y);
            y += rowSpacing;
        }
        frontier.update(levels.get(node.id) ?? 0, nextY);
    };

    setY(model.root, 5);
    return positions;
}

export function getHiddenExecutionPlanElementIds(
    model: ExecutionPlanModel,
    collapsedNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
    const hidden = new Set<string>();
    const hideDescendants = (nodeId: string): void => {
        for (const childId of model.getChildIds(nodeId)) {
            hidden.add(childId);
            hideDescendants(childId);
        }
    };

    for (const nodeId of collapsedNodeIds) {
        hideDescendants(nodeId);
    }
    return hidden;
}
