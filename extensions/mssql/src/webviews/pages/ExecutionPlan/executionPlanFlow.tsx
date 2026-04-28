/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BaseEdge,
    Controls,
    Handle,
    NodeToolbar,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeProps,
    type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type * as ep from "../../../sharedInterfaces/executionPlan";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import * as utils from "./queryPlanSetup";
import {
    CELL_HEIGHT,
    CELL_WIDTH,
    NODE_HEIGHT,
    NODE_WIDTH,
    cleanNodeLabel,
    getGraphBounds,
    layoutExecutionPlanGraph,
    truncateTooltipTitle,
    type LayoutExecutionPlanNode,
} from "./executionPlanLayout";
import type { ExecutionPlanDiagramController } from "./executionPlanView";

interface ExecutionPlanNodeData extends Record<string, unknown> {
    node: LayoutExecutionPlanNode;
    iconPaths: Record<string, string>;
    badgeIconPaths: Record<string, string>;
    expandCollapsePaths: Record<string, string>;
    selected: boolean;
    highlighted: boolean;
    collapsed: boolean;
    collapseDisabled: boolean;
    tooltipsEnabled: boolean;
    onSelect: (id: string) => void;
    onToggleCollapse: (id: string) => void;
    onNavigate: (id: string, key: string) => void;
    onToggleTooltip: (id: string, anchor: DOMRect) => void;
    onHideTooltip: () => void;
}

interface ExecutionPlanEdgeData extends Record<string, unknown> {
    edge: ep.AzDataGraphCellEdge;
    sourceNode: LayoutExecutionPlanNode;
    targetNode: LayoutExecutionPlanNode;
    selected: boolean;
    onSelect: (id: string) => void;
    onToggleTooltip: (id: string, anchor: { x: number; y: number }) => void;
}

export interface ExecutionPlanFlowHandle {
    controller: ExecutionPlanDiagramController;
    selectedElementId: string | undefined;
}

interface ExecutionPlanFlowProps {
    graph: ep.AzDataGraphCell;
    graphIndex: number;
    themeKind: ColorThemeKind;
    onReady: (handle: ExecutionPlanFlowHandle) => void;
}

interface TooltipState {
    id: string;
    x: number;
    y: number;
    metrics: ep.AzDataGraphCellMetric[];
    title?: string;
    description?: string;
    isEdge: boolean;
}

function isNodeElement(element: ep.InternalExecutionPlanElement): element is ep.ExecutionPlanNode {
    return "name" in element;
}

function getNodeById(
    root: LayoutExecutionPlanNode,
    id: string,
): LayoutExecutionPlanNode | undefined {
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.id === id) {
            return node;
        }
        stack.push(...node.children);
    }
    return undefined;
}

function getParent(root: LayoutExecutionPlanNode, id: string): LayoutExecutionPlanNode | undefined {
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.children.some((child) => child.id === id)) {
            return node;
        }
        stack.push(...node.children);
    }
    return undefined;
}

function getVisibleNodeIds(
    root: LayoutExecutionPlanNode,
    collapsedNodeIds: Set<string>,
): Set<string> {
    const visibleNodeIds = new Set<string>();
    const visit = (node: LayoutExecutionPlanNode) => {
        visibleNodeIds.add(node.id);
        if (collapsedNodeIds.has(node.id)) {
            return;
        }
        node.children.forEach(visit);
    };

    visit(root);
    return visibleNodeIds;
}

function getVisibleChildren(
    node: LayoutExecutionPlanNode,
    visibleNodeIds: Set<string>,
): LayoutExecutionPlanNode[] {
    return node.children.filter((child) => visibleNodeIds.has(child.id));
}

function getSibling(
    root: LayoutExecutionPlanNode,
    id: string,
    offset: number,
): LayoutExecutionPlanNode | undefined {
    const parent = getParent(root, id);
    if (!parent) {
        return undefined;
    }

    const index = parent.children.findIndex((child) => child.id === id);
    if (index === -1) {
        return undefined;
    }

    return parent.children[index + offset];
}

function buildTooltipForNode(node: LayoutExecutionPlanNode, anchor: DOMRect): TooltipState {
    return {
        id: node.id,
        x: anchor.x + anchor.width,
        y: anchor.y + anchor.height,
        title: truncateTooltipTitle(node.tooltipTitle),
        description: node.description,
        metrics: node.metrics,
        isEdge: false,
    };
}

function buildTooltipForEdge(
    edge: ep.AzDataGraphCellEdge,
    anchor: { x: number; y: number },
): TooltipState {
    return {
        id: edge.id,
        x: anchor.x,
        y: anchor.y,
        metrics: edge.metrics,
        isEdge: true,
    };
}

function getTooltipTitleParts(title: string | undefined): {
    name: string | undefined;
    subtype: string | undefined;
} {
    if (!title) {
        return { name: undefined, subtype: undefined };
    }

    const titleParts = title
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

    return {
        name: titleParts[0],
        subtype: titleParts.length > 1 ? titleParts.slice(1).join(" ") : undefined,
    };
}

function ExecutionPlanTooltip({ tooltip }: { tooltip: TooltipState }) {
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState({ x: tooltip.x, y: tooltip.y });
    const titleParts = getTooltipTitleParts(tooltip.title);
    const regularMetrics = tooltip.isEdge ? tooltip.metrics : tooltip.metrics.slice(1);
    const longStringMetrics = tooltip.isEdge
        ? []
        : tooltip.metrics.filter((metric) => metric.isLongString);
    const shortMetrics = regularMetrics.filter((metric) => !metric.isLongString);

    useLayoutEffect(() => {
        const tooltipElement = tooltipRef.current;
        if (!tooltipElement) {
            return;
        }

        const margin = 8;
        const rect = tooltipElement.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - margin;
        const maxY = window.innerHeight - rect.height - margin;

        setPosition({
            x: Math.max(margin, Math.min(tooltip.x, maxX)),
            y: Math.max(margin, Math.min(tooltip.y, maxY)),
        });
    }, [tooltip.x, tooltip.y, tooltip.id]);

    return (
        <div
            ref={tooltipRef}
            className="execution-plan-tooltip"
            style={{
                left: position.x,
                top: position.y,
            }}>
            {!tooltip.isEdge && (
                <div className="execution-plan-tooltip-header">
                    {titleParts.name && (
                        <div className="execution-plan-tooltip-title">{titleParts.name}</div>
                    )}
                    {titleParts.subtype && (
                        <div className="execution-plan-tooltip-subtitle">{titleParts.subtype}</div>
                    )}
                    {tooltip.description && (
                        <div className="execution-plan-tooltip-description">
                            {tooltip.description}
                        </div>
                    )}
                </div>
            )}
            {shortMetrics.length > 0 && (
                <div className="execution-plan-tooltip-metrics">
                    {shortMetrics.map((metric, index) => (
                        <div className="execution-plan-tooltip-row" key={`${metric.name}-${index}`}>
                            <span className="execution-plan-tooltip-label">{metric.name}</span>
                            <span className="execution-plan-tooltip-value">{metric.value}</span>
                        </div>
                    ))}
                </div>
            )}
            {longStringMetrics.length > 0 && (
                <div className="execution-plan-tooltip-details">
                    {longStringMetrics.map((metric, index) => (
                        <div
                            className="execution-plan-tooltip-detail"
                            key={`${metric.name}-${index}`}>
                            <div className="execution-plan-tooltip-detail-title">{metric.name}</div>
                            <div className="execution-plan-tooltip-detail-value">
                                {metric.value}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const ExecutionPlanOperatorNode = memo((props: NodeProps<Node<ExecutionPlanNodeData>>) => {
    const { data } = props;
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const node = data.node;
    const label = cleanNodeLabel(node.label, node.icon);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
            data.onNavigate(node.id, event.key);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.key === "Enter") {
            const anchor = bodyRef.current?.getBoundingClientRect();
            if (anchor) {
                data.onToggleTooltip(node.id, anchor);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.key === "Escape") {
            data.onHideTooltip();
            event.preventDefault();
            event.stopPropagation();
        }
    };

    return (
        <div className="execution-plan-node-container">
            <Handle
                type="target"
                position={Position.Left}
                className="execution-plan-hidden-handle"
            />
            <div className="graph-cell-row-count">{node.rowCountDisplayString}</div>
            {node.children.length > 0 && !data.collapseDisabled && (
                <NodeToolbar isVisible position={Position.Top} align="end" offset={-4}>
                    <button
                        type="button"
                        className={`graph-icon-badge-expand ${
                            data.collapsed ? "expanded" : "collapsed"
                        }`}
                        aria-label={`${data.collapsed ? "Expand node" : "Collapse node"} ${node.label}`}
                        aria-expanded={!data.collapsed}
                        onClick={(event) => {
                            event.stopPropagation();
                            data.onToggleCollapse(node.id);
                        }}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                        }}
                    />
                </NodeToolbar>
            )}
            <div
                ref={bodyRef}
                className={`graph-cell-body ${data.selected ? "selected" : ""} ${
                    data.highlighted ? "expensive-highlight" : ""
                }`}
                role="treeitem"
                tabIndex={data.selected ? 0 : -1}
                aria-selected={data.selected}
                aria-expanded={node.children.length > 0 ? !data.collapsed : undefined}
                aria-level={node.depth}
                aria-posinset={node.posInSet}
                aria-setsize={node.setSize}
                onFocus={() => data.onSelect(node.id)}
                onClick={() => {
                    data.onSelect(node.id);
                    const anchor = bodyRef.current?.getBoundingClientRect();
                    if (anchor) {
                        data.onToggleTooltip(node.id, anchor);
                    }
                }}
                onKeyDown={handleKeyDown}>
                <div className="graph-cell-cost">{node.costDisplayString}</div>
                <div
                    className="graph-cell-icon"
                    style={{
                        backgroundImage: `url(${data.iconPaths[node.icon]})`,
                    }}>
                    {node.badges?.map((badge, index) => (
                        <div
                            key={`${badge.type}-${index}`}
                            className="graph-icon-badge"
                            title={badge.tooltip}
                            style={{
                                backgroundImage: `url(${data.badgeIconPaths[badge.type]})`,
                            }}
                        />
                    ))}
                </div>
                <div className="graph-cell-label">{label}</div>
            </div>
            <Handle
                type="source"
                position={Position.Right}
                className="execution-plan-hidden-handle"
            />
        </div>
    );
});
ExecutionPlanOperatorNode.displayName = "ExecutionPlanOperatorNode";

function ExecutionPlanWeightedEdge(props: EdgeProps<Edge<ExecutionPlanEdgeData>>) {
    const { id, sourceX, sourceY, targetX, targetY, data, selected } = props;
    const strokeWidth = Math.max((data?.edge.weight ?? 1) * 1.1, 1.5);
    const arrowLength = Math.max(18, strokeWidth * 3);
    const arrowHalfHeight = Math.max(7, strokeWidth * 1.2);
    const arrowTipX = sourceX - 8;
    const arrowBaseX = arrowTipX + arrowLength;
    const visibleSourceX = arrowBaseX + strokeWidth / 2;
    const midX = visibleSourceX + (targetX - visibleSourceX) / 2;
    const edgePath = `M ${visibleSourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
    const hitPath = `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                className={`execution-plan-edge-path ${selected ? "selected" : ""}`}
                style={{
                    strokeWidth,
                }}
                interactionWidth={Math.max(20, strokeWidth + 14)}
            />
            <polygon
                points={`${arrowTipX},${sourceY} ${arrowBaseX},${sourceY - arrowHalfHeight} ${arrowBaseX},${sourceY + arrowHalfHeight}`}
                className={`execution-plan-edge-arrow ${selected ? "selected" : ""}`}
            />
            <path
                d={hitPath}
                className={`execution-plan-edge-hit-target ${selected ? "selected" : ""}`}
                onClick={(event) => {
                    event.stopPropagation();
                    data?.onSelect(id);
                    data?.onToggleTooltip(id, { x: event.clientX, y: event.clientY });
                }}
            />
        </>
    );
}

function buildFlowElements(
    root: LayoutExecutionPlanNode,
    visibleNodeIds: Set<string>,
    collapsedNodeIds: Set<string>,
    selectedId: string | undefined,
    highlightedId: string | undefined,
    collapseDisabled: boolean,
    tooltipsEnabled: boolean,
    iconPaths: Record<string, string>,
    badgeIconPaths: Record<string, string>,
    expandCollapsePaths: Record<string, string>,
    callbacks: Pick<
        ExecutionPlanNodeData,
        "onSelect" | "onToggleCollapse" | "onNavigate" | "onToggleTooltip" | "onHideTooltip"
    > &
        Pick<ExecutionPlanEdgeData, "onToggleTooltip">,
): {
    nodes: Node<ExecutionPlanNodeData>[];
    edges: Edge<ExecutionPlanEdgeData>[];
} {
    const nodes: Node<ExecutionPlanNodeData>[] = [];
    const edges: Edge<ExecutionPlanEdgeData>[] = [];
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.pop()!;
        if (!visibleNodeIds.has(node.id)) {
            continue;
        }

        nodes.push({
            id: node.id,
            type: "executionPlanOperator",
            position: node.position,
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
            data: {
                node,
                iconPaths,
                badgeIconPaths,
                expandCollapsePaths,
                selected: selectedId === node.id,
                highlighted: highlightedId === node.id,
                collapsed: collapsedNodeIds.has(node.id),
                collapseDisabled,
                tooltipsEnabled,
                onSelect: callbacks.onSelect,
                onToggleCollapse: callbacks.onToggleCollapse,
                onNavigate: callbacks.onNavigate,
                onToggleTooltip: callbacks.onToggleTooltip,
                onHideTooltip: callbacks.onHideTooltip,
            },
            draggable: false,
            selectable: true,
        });

        node.children.forEach((child, index) => {
            if (!visibleNodeIds.has(child.id)) {
                return;
            }

            const edge = node.edges[index];
            if (edge) {
                edges.push({
                    id: edge.id,
                    source: node.id,
                    target: child.id,
                    type: "executionPlanWeighted",
                    data: {
                        edge,
                        sourceNode: node,
                        targetNode: child,
                        selected: selectedId === edge.id,
                        onSelect: callbacks.onSelect,
                        onToggleTooltip: callbacks.onToggleTooltip,
                    },
                    selected: selectedId === edge.id,
                    selectable: true,
                });
            }
            stack.push(child);
        });
    }

    return { nodes, edges };
}

function ExecutionPlanFlowInner({ graph, graphIndex, themeKind, onReady }: ExecutionPlanFlowProps) {
    const reactFlow = useReactFlow<Node<ExecutionPlanNodeData>, Edge<ExecutionPlanEdgeData>>();
    const root = useMemo(() => layoutExecutionPlanGraph(graph), [graph]);
    const iconPaths = useMemo(() => utils.getIconPaths() as Record<string, string>, []);
    const badgeIconPaths = useMemo(() => utils.getBadgePaths() as Record<string, string>, []);
    const expandCollapsePaths = useMemo(
        () => utils.getCollapseExpandPaths(themeKind) as Record<string, string>,
        [themeKind],
    );
    const [selectedId, setSelectedId] = useState<string>(root.id);
    const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
    const [tooltipState, setTooltipState] = useState<TooltipState | undefined>();
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
    const [highlightedId, setHighlightedId] = useState<string | undefined>();
    const [collapseDisabled, setCollapseDisabled] = useState(false);
    const [subtreePolygonRootId, setSubtreePolygonRootId] = useState<string | undefined>();
    const [, setViewportVersion] = useState(0);

    const visibleNodeIds = useMemo(
        () => getVisibleNodeIds(root, collapsedNodeIds),
        [collapsedNodeIds, root],
    );

    const selectElement = useCallback(
        (id: string | undefined, bringToCenter = false) => {
            const targetId = id ?? root.id;
            setSelectedId(targetId);
            setTooltipState(undefined);
            if (bringToCenter) {
                const node = getNodeById(root, targetId);
                if (node) {
                    void reactFlow.setCenter(
                        node.position.x + CELL_WIDTH / 2,
                        node.position.y + CELL_HEIGHT / 2,
                        {
                            duration: 500,
                            zoom: reactFlow.getZoom(),
                        },
                    );
                }
            }
        },
        [reactFlow, root],
    );

    const toggleCollapse = useCallback((id: string) => {
        setCollapsedNodeIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        setTooltipState(undefined);
    }, []);

    const hideTooltip = useCallback(() => setTooltipState(undefined), []);

    const toggleNodeTooltip = useCallback(
        (id: string, anchor: DOMRect) => {
            if (!tooltipsEnabled) {
                return;
            }
            setTooltipState((current) => {
                if (current?.id === id) {
                    return undefined;
                }
                const node = getNodeById(root, id);
                return node ? buildTooltipForNode(node, anchor) : undefined;
            });
        },
        [root, tooltipsEnabled],
    );

    const toggleEdgeTooltip = useCallback(
        (id: string, anchor: { x: number; y: number }) => {
            if (!tooltipsEnabled) {
                return;
            }
            setTooltipState((current) => {
                if (current?.id === id) {
                    return undefined;
                }
                const edge = reactFlow.getEdges().find((flowEdge) => flowEdge.id === id)
                    ?.data?.edge;
                return edge ? buildTooltipForEdge(edge, anchor) : undefined;
            });
        },
        [reactFlow, tooltipsEnabled],
    );

    const navigate = useCallback(
        (id: string, key: string) => {
            const node = getNodeById(root, id);
            if (!node) {
                return;
            }

            let next: LayoutExecutionPlanNode | undefined;
            if (key === "ArrowRight" && !collapsedNodeIds.has(node.id)) {
                next = getVisibleChildren(node, visibleNodeIds)[0];
            } else if (key === "ArrowLeft") {
                next = getParent(root, id);
            } else if (key === "ArrowUp") {
                next = getSibling(root, id, -1);
            } else if (key === "ArrowDown") {
                next = getSibling(root, id, 1);
            }

            if (next && visibleNodeIds.has(next.id)) {
                selectElement(next.id, true);
            }
        },
        [collapsedNodeIds, root, selectElement, visibleNodeIds],
    );

    const callbacks = useMemo(
        () => ({
            onSelect: (id: string) => selectElement(id),
            onToggleCollapse: toggleCollapse,
            onNavigate: navigate,
            onToggleTooltip: (id: string, anchor: DOMRect | { x: number; y: number }) => {
                if ("width" in anchor) {
                    toggleNodeTooltip(id, anchor);
                } else {
                    toggleEdgeTooltip(id, anchor);
                }
            },
            onHideTooltip: hideTooltip,
        }),
        [
            hideTooltip,
            navigate,
            selectElement,
            toggleCollapse,
            toggleEdgeTooltip,
            toggleNodeTooltip,
        ],
    );

    const { nodes, edges } = useMemo(
        () =>
            buildFlowElements(
                root,
                visibleNodeIds,
                collapsedNodeIds,
                selectedId,
                highlightedId,
                collapseDisabled,
                tooltipsEnabled,
                iconPaths,
                badgeIconPaths,
                expandCollapsePaths,
                callbacks,
            ),
        [
            badgeIconPaths,
            callbacks,
            collapseDisabled,
            collapsedNodeIds,
            expandCollapsePaths,
            highlightedId,
            iconPaths,
            root,
            selectedId,
            tooltipsEnabled,
            visibleNodeIds,
        ],
    );

    const polygonPoints = useMemo(() => {
        if (!subtreePolygonRootId) {
            return undefined;
        }

        const node = getNodeById(root, subtreePolygonRootId);
        if (!node || !visibleNodeIds.has(node.id)) {
            return undefined;
        }

        const descendants: LayoutExecutionPlanNode[] = [];
        const stack = [node];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (!visibleNodeIds.has(current.id)) {
                continue;
            }
            descendants.push(current);
            stack.push(...current.children);
        }

        const minX = Math.min(...descendants.map((d) => d.position.x)) - 15;
        const minY = Math.min(...descendants.map((d) => d.position.y));
        const maxX = Math.max(...descendants.map((d) => d.position.x + NODE_WIDTH + 20));
        const maxY = Math.max(...descendants.map((d) => d.position.y + NODE_HEIGHT));
        return `${minX},${minY} ${maxX},${minY} ${maxX},${maxY} ${minX},${maxY}`;
    }, [root, subtreePolygonRootId, visibleNodeIds]);

    useEffect(() => {
        const controller: ExecutionPlanDiagramController = {
            zoomIn: () => {
                void reactFlow.zoomTo(Math.min(reactFlow.getZoom() * 1.2, 2));
                setViewportVersion((value) => value + 1);
            },
            zoomOut: () => {
                void reactFlow.zoomTo(reactFlow.getZoom() / 1.2);
                setViewportVersion((value) => value + 1);
            },
            zoomToFit: () => {
                void reactFlow.fitView({ padding: 0.2, duration: 500 });
                setViewportVersion((value) => value + 1);
            },
            setZoomLevel: (level: number) => {
                const parsedZoomLevel = Math.max(1, Math.min(parseInt(level.toString()), 200));
                void reactFlow.zoomTo(parsedZoomLevel / 100);
                setViewportVersion((value) => value + 1);
            },
            getZoomLevel: () => reactFlow.getZoom() * 100,
            selectElement: (element, bringToCenter = false) => {
                selectElement(element?.id, bringToCenter);
            },
            centerElement: (element) => {
                if (element && isNodeElement(element)) {
                    selectElement(element.id, true);
                }
            },
            toggleTooltip: () => {
                const next = !tooltipsEnabled;
                setTooltipsEnabled(next);
                if (!next) {
                    setTooltipState(undefined);
                }
                return next;
            },
            clearExpensiveOperatorHighlighting: () => setHighlightedId(undefined),
            highlightExpensiveOperator: (predicate) => {
                const expensiveOperators: LayoutExecutionPlanNode[] = [];
                const expensiveCostValues: number[] = [];
                const stack = [root];

                while (stack.length > 0) {
                    const current = stack.pop()!;
                    const costValue = predicate(current);

                    if (costValue !== undefined && costValue >= 0) {
                        expensiveOperators.push(current);
                        expensiveCostValues.push(costValue);
                    }

                    stack.push(...current.children);
                }

                if (expensiveCostValues.length === 0) {
                    return undefined;
                }

                const maxCostValue = Math.max(...expensiveCostValues);
                const expensiveNode = expensiveOperators[expensiveCostValues.indexOf(maxCostValue)];
                setHighlightedId(expensiveNode.id);
                return expensiveNode.id;
            },
            drawSubtreePolygon: (subtreeRoot) => setSubtreePolygonRootId(`element-${subtreeRoot}`),
            clearSubtreePolygon: () => setSubtreePolygonRootId(undefined),
            disableNodeCollapse: setCollapseDisabled,
            getSelectedElementId: () => selectedId,
        };

        onReady({ controller, selectedElementId: selectedId });
    }, [onReady, reactFlow, root, selectElement, selectedId, tooltipsEnabled]);

    useEffect(() => {
        const selectedNode = document.querySelector<HTMLElement>(
            `#execution-plan-flow-${graphIndex} [data-id="${selectedId}"] .graph-cell-body`,
        );
        selectedNode?.focus({ preventScroll: true });
    }, [graphIndex, selectedId]);

    const bounds = getGraphBounds(root);

    return (
        <div id={`execution-plan-flow-${graphIndex}`} className="execution-plan-flow">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={{ executionPlanOperator: ExecutionPlanOperatorNode }}
                edgeTypes={{ executionPlanWeighted: ExecutionPlanWeightedEdge }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                panOnDrag
                minZoom={0.01}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                fitView
                onInit={(
                    instance: ReactFlowInstance<
                        Node<ExecutionPlanNodeData>,
                        Edge<ExecutionPlanEdgeData>
                    >,
                ) => {
                    void instance.fitView({ padding: 0.2 });
                }}
                onPaneClick={() => setTooltipState(undefined)}>
                <Controls showInteractive={false} />
                {polygonPoints && (
                    <svg
                        className="execution-plan-subtree-polygon"
                        width={bounds.maxX}
                        height={bounds.maxY}>
                        <polygon points={polygonPoints} />
                    </svg>
                )}
            </ReactFlow>
            {tooltipState && <ExecutionPlanTooltip tooltip={tooltipState} />}
        </div>
    );
}

export function ExecutionPlanFlow(props: ExecutionPlanFlowProps) {
    return (
        <ReactFlowProvider>
            <ExecutionPlanFlowInner {...props} />
        </ReactFlowProvider>
    );
}
