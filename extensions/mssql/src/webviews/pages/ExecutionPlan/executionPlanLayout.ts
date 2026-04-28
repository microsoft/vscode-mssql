/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as ep from "../../../sharedInterfaces/executionPlan";

export const GRAPH_PADDING_RIGHT = 40;
export const GRAPH_PADDING_TOP = 0;
export const GRAPH_PADDING_BOTTOM = 80;
export const GRAPH_PADDING_LEFT = 40;
export const CELL_WIDTH = 80;
export const CELL_HEIGHT = 80;
export const STANDARD_NODE_DISTANCE = 173;
export const IDEAL_LONG_LABEL_NODE_DISTANCE = 240;
export const CELL_ICON_HEIGHT = 30;
export const CELL_COST_HEIGHT = 15;
export const MAX_ALLOWED_NODE_WIDTH = 200;
export const MIN_ALLOWED_NODE_WIDTH = 80;
export const LABEL_LENGTH_LIMIT = 38;
export const NODE_HEIGHT = 105;
export const NODE_WIDTH = 100;

export interface LayoutPoint {
    x: number;
    y: number;
}

export interface LayoutExecutionPlanNode extends ep.AzDataGraphCell {
    position: LayoutPoint;
    level: number;
    maxChildrenXPosition: number;
    parent?: LayoutExecutionPlanNode;
    depth: number;
    posInSet: number;
    setSize: number;
    isRoot?: boolean;
    children: LayoutExecutionPlanNode[];
    edges: ep.AzDataGraphCellEdge[];
}

class GraphNodeLayoutHelper {
    private layoutPoints: LayoutPoint[] = [];

    private checkInvariant(): void {
        let last: LayoutPoint = { x: 0, y: 0 };

        for (const layoutPoint of this.layoutPoints) {
            if (last.x > layoutPoint.x || last.y > layoutPoint.y) {
                console.log("Graph layout failed.");
            }

            last = layoutPoint;
        }
    }

    public updateNodeLayout(nodeLevel: number, yPosition: number): void {
        this.checkInvariant();

        if (this.layoutPoints.length === 0) {
            this.layoutPoints.push({ x: nodeLevel, y: yPosition });
            return;
        }

        if (this.layoutPoints.length === 1) {
            if (nodeLevel < this.layoutPoints[0].x) {
                this.layoutPoints.unshift({ x: nodeLevel, y: yPosition });
            } else if (nodeLevel === this.layoutPoints[0].x) {
                this.layoutPoints[0] = {
                    x: this.layoutPoints[0].x,
                    y: Math.max(this.layoutPoints[0].y, yPosition),
                };
            } else {
                this.layoutPoints.push({ x: nodeLevel, y: yPosition });
            }

            return;
        }

        if (nodeLevel < this.layoutPoints[0].x && yPosition < this.layoutPoints[0].y) {
            this.layoutPoints.unshift({ x: nodeLevel, y: yPosition });
            return;
        }

        if (
            this.layoutPoints[this.layoutPoints.length - 1].x < nodeLevel &&
            this.layoutPoints[this.layoutPoints.length - 1].y < yPosition
        ) {
            this.layoutPoints.push({ x: nodeLevel, y: yPosition });
            return;
        }

        if (this.layoutPoints[this.layoutPoints.length - 1].x === nodeLevel) {
            const last = this.layoutPoints[this.layoutPoints.length - 1];
            this.layoutPoints[this.layoutPoints.length - 1] = {
                x: nodeLevel,
                y: Math.max(last.y, yPosition),
            };
            return;
        }

        let insertIndex = 0;
        for (let i = 0; i < this.layoutPoints.length; i++) {
            if (nodeLevel <= this.layoutPoints[i].x) {
                insertIndex = i;
                break;
            }
        }

        if (nodeLevel === this.layoutPoints[insertIndex].x) {
            this.layoutPoints[insertIndex] = {
                x: nodeLevel,
                y: Math.max(this.layoutPoints[insertIndex].y, yPosition),
            };
        } else {
            this.layoutPoints.splice(insertIndex, 0, { x: nodeLevel, y: yPosition });
        }

        let lastIndex = insertIndex;
        while (lastIndex < this.layoutPoints.length) {
            if (this.layoutPoints[lastIndex].y > yPosition) {
                this.layoutPoints.splice(insertIndex + 1, lastIndex - insertIndex - 1);
                return;
            }
            ++lastIndex;
        }

        this.layoutPoints.splice(insertIndex + 1, this.layoutPoints.length - insertIndex - 1);
    }

    public getYPositionForXPosition(rowX: number): number {
        this.checkInvariant();

        let yPosition = 0;
        for (const layoutPoint of this.layoutPoints) {
            if (rowX < layoutPoint.x) {
                break;
            }

            yPosition = Math.max(layoutPoint.y, yPosition);
        }

        return yPosition;
    }
}

let canvas: HTMLCanvasElement | undefined;

function getNodeLabelLength(node: LayoutExecutionPlanNode): number {
    if (typeof document === "undefined") {
        return node.label.length * 7;
    }

    canvas = canvas ?? document.createElement("canvas");
    const context = canvas.getContext("2d");
    return context?.measureText(node.label).width ?? node.label.length * 7;
}

function isParentHierarchyTreeStructure(node: LayoutExecutionPlanNode): boolean {
    let current: LayoutExecutionPlanNode | undefined = node;
    while (current) {
        if (current.children.length >= 2) {
            return true;
        }
        current = current.parent;
    }
    return false;
}

function getRecommendedNodeXSpacing(node: LayoutExecutionPlanNode): number {
    const currentNodeSize = getNodeLabelLength(node);
    let maxNodeToWidth = 0;
    node.children.forEach((child) => {
        maxNodeToWidth = Math.max(maxNodeToWidth, getNodeLabelLength(child));
    });

    let recommendedSpacing = currentNodeSize / 2 + maxNodeToWidth / 2;
    if (node.children.length > 1 && isParentHierarchyTreeStructure(node)) {
        recommendedSpacing += Math.max(maxNodeToWidth - MAX_ALLOWED_NODE_WIDTH, 0);
    }

    return recommendedSpacing < MIN_ALLOWED_NODE_WIDTH
        ? MIN_ALLOWED_NODE_WIDTH
        : recommendedSpacing;
}

function getNodeHeight(node: LayoutExecutionPlanNode): number {
    const cellSubtextLineCount = node.label.split(/\r\n|\r|\n/).length;
    return CELL_ICON_HEIGHT + CELL_COST_HEIGHT + cellSubtextLineCount * 10;
}

function setNodeXPositionRecursive(
    node: LayoutExecutionPlanNode,
    x: number,
    level: number,
    spacing: { y: number },
): void {
    node.position = { x, y: 0 };
    node.level = level;
    spacing.y = Math.max(spacing.y, getNodeHeight(node));

    const spacingX = getRecommendedNodeXSpacing(node) + GRAPH_PADDING_RIGHT;
    const childX = x + spacingX;

    node.maxChildrenXPosition = node.level;
    node.children.forEach((childNode) => {
        childNode.parent = node;
        setNodeXPositionRecursive(childNode, childX, level + 1, spacing);
        node.maxChildrenXPosition = Math.max(
            node.maxChildrenXPosition,
            childNode.maxChildrenXPosition,
        );
    });
}

function setNodeYPositionRecursive(
    node: LayoutExecutionPlanNode,
    layoutHelper: GraphNodeLayoutHelper,
    y: number,
    spacingY: number,
): void {
    let newY = Math.max(y, layoutHelper.getYPositionForXPosition(node.maxChildrenXPosition));

    node.position.y = newY;
    const yToUpdate = newY + spacingY;

    node.children.forEach((child) => {
        setNodeYPositionRecursive(child, layoutHelper, newY, spacingY);
        newY += spacingY;
    });

    layoutHelper.updateNodeLayout(node.level, yToUpdate);
}

function setAccessibilityMetadata(node: LayoutExecutionPlanNode): void {
    const stack: LayoutExecutionPlanNode[] = [node];
    node.depth = 1;
    node.posInSet = 1;
    node.setSize = 1;
    node.isRoot = true;

    while (stack.length > 0) {
        const current = stack.pop()!;
        current.children.forEach((child, index) => {
            child.depth = current.depth + 1;
            child.posInSet = index + 1;
            child.setSize = current.children.length;
            stack.push(child);
        });
    }
}

export function calculateEdgeWeight(rowCount: number): number {
    return Math.max(0.5, Math.min(0.5 + 0.75 * Math.log10(rowCount), 6));
}

export function layoutExecutionPlanGraph(graph: ep.AzDataGraphCell): LayoutExecutionPlanNode {
    const root = graph as LayoutExecutionPlanNode;
    const spacing = { y: NODE_HEIGHT };
    const startX = (GRAPH_PADDING_RIGHT + 10) / 2;
    const startY = (GRAPH_PADDING_TOP + 10) / 2;

    setNodeXPositionRecursive(root, startX, 0, spacing);
    setNodeYPositionRecursive(root, new GraphNodeLayoutHelper(), startY, spacing.y);
    setAccessibilityMetadata(root);

    return root;
}

export function getGraphBounds(root: LayoutExecutionPlanNode): {
    maxX: number;
    maxY: number;
} {
    let maxX = root.position.x;
    let maxY = root.position.y;
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.pop()!;
        maxX = Math.max(maxX, node.position.x);
        maxY = Math.max(maxY, node.position.y);
        stack.push(...node.children);
    }

    return {
        maxX: maxX + CELL_WIDTH + GRAPH_PADDING_LEFT,
        maxY: maxY + CELL_HEIGHT + GRAPH_PADDING_BOTTOM,
    };
}

export function cleanNodeLabel(label: string, icon?: string): string {
    const hasWindowsEOL = label.includes("\r\n");
    const joinStrings = (strArray: string[]) =>
        hasWindowsEOL ? strArray.join("\r\n") : strArray.join("\n");

    const splitLabel = label.split(/\r\n|\n/);
    return joinStrings(
        splitLabel.map((str, index) => {
            if (index === 0 && !icon?.includes("columnstore")) {
                return str.replace(/\(([^)]+)\)/g, "");
            }

            if (index === 1 && splitLabel.length >= 3 && str.includes(".")) {
                return str
                    .split(" ")
                    .map((part) =>
                        part.length >= LABEL_LENGTH_LIMIT
                            ? `${part.substring(0, LABEL_LENGTH_LIMIT - 3)}...`
                            : part,
                    )
                    .join(" ");
            }

            return str;
        }),
    );
}

export function truncateTooltipTitle(title: string): string {
    const hasWindowsEOL = title.includes("\r\n");
    const titleSegments = hasWindowsEOL ? title.split("\r\n") : title.split("\n");
    const truncatedTitleSegments = titleSegments.map((segment) =>
        segment.length > 50 ? `${segment.substring(0, 50)}...` : segment,
    );

    return hasWindowsEOL ? truncatedTitleSegments.join("\r\n") : truncatedTitleSegments.join("\n");
}
