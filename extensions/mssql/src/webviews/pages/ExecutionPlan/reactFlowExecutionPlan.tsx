/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "@xyflow/react/dist/style.css";
import "./reactFlowExecutionPlan.css";

import {
    Edge,
    EdgeProps,
    EdgeTypes,
    Handle,
    Node,
    NodeProps,
    NodeTypes,
    Position,
    ReactFlow,
    ReactFlowInstance,
    getSmoothStepPath,
} from "@xyflow/react";
import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    BadgeType,
    ExecutionPlanNode,
    InternalExecutionPlanElement,
    SearchQuery,
} from "../../../sharedInterfaces/executionPlan";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { SqlText } from "../../common/sqlText";
import {
    ExecutionPlanGraphController,
    ExecutionPlanMetricSource,
} from "./executionPlanGraphController";
import {
    EXECUTION_PLAN_NODE_HEIGHT,
    EXECUTION_PLAN_NODE_WIDTH,
    ExecutionPlanEdgeModel,
    ExecutionPlanModel,
    ExecutionPlanNodePositions,
    getHiddenExecutionPlanElementIds,
    layoutExecutionPlan,
} from "./executionPlanModel";
import { getExecutionPlanClassicArrowGeometry } from "./executionPlanEdgeGeometry";
import {
    ExecutionPlanTooltipContent,
    formatExecutionPlanEdgeTooltip,
    formatExecutionPlanNodeTooltip,
} from "./executionPlanTooltip";
import { getViewportToRevealExecutionPlanNode } from "./executionPlanViewport";
import { getBadgePaths, getCollapseExpandPaths, getIconPaths } from "./queryPlanSetup";

const EXECUTION_PLAN_REVEAL_PADDING = 0;
const EXECUTION_PLAN_FOCUS_RETRY_FRAMES = 20;

interface TooltipState {
    content: ExecutionPlanTooltipContent;
    x: number;
    y: number;
}

interface ExecutionPlanFlowNodeData extends Record<string, unknown> {
    planNode: ExecutionPlanNode;
    depth: number;
    siblingIndex: number;
    siblingCount: number;
    collapsed: boolean;
    highlighted: boolean;
    selected: boolean;
    themeKind: ColorThemeKind;
    registerElement: (id: string, element: HTMLDivElement | null) => void;
    focusSelection: (id: string) => void;
    closeTooltip: () => void;
    activate: (id: string, bounds: DOMRect) => void;
    navigate: (id: string, event: ReactKeyboardEvent<HTMLDivElement>, bounds: DOMRect) => void;
    toggleCollapse: (id: string) => void;
}

type ExecutionPlanFlowNode = Node<ExecutionPlanFlowNodeData, "executionPlan">;
interface ExecutionPlanFlowEdgeData extends ExecutionPlanEdgeModel {
    [key: string]: unknown;
}
type ExecutionPlanFlowEdge = Edge<ExecutionPlanFlowEdgeData>;

function ExecutionPlanReactFlowNode({ data }: NodeProps<ExecutionPlanFlowNode>) {
    const {
        planNode,
        depth,
        siblingIndex,
        siblingCount,
        collapsed,
        highlighted,
        selected,
        themeKind,
        registerElement,
        focusSelection,
        activate,
        navigate,
        toggleCollapse,
    } = data;
    const iconPaths = getIconPaths() as Record<string, string>;
    const badgePaths = getBadgePaths();
    const collapseExpandPaths = getCollapseExpandPaths(themeKind);
    const iconPath = iconPaths[planNode.type] ?? iconPaths.iteratorCatchAll;
    const badgePath = (type: BadgeType): string => {
        switch (type) {
            case BadgeType.CriticalWarning:
                return badgePaths.criticalWarning;
            case BadgeType.Parallelism:
                return badgePaths.parallelism;
            case BadgeType.Warning:
                return badgePaths.warning;
        }
    };
    const bounds = (event: { currentTarget: EventTarget & HTMLElement }) =>
        event.currentTarget.getBoundingClientRect();

    return (
        <div
            ref={(element) => registerElement(planNode.id, element)}
            data-execution-plan-node-id={planNode.id}
            className={[
                "execution-plan-flow-node",
                selected ? "selected" : "",
                highlighted ? "highlighted" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            style={
                {
                    width: EXECUTION_PLAN_NODE_WIDTH,
                    height: EXECUTION_PLAN_NODE_HEIGHT,
                } as CSSProperties
            }
            role="treeitem"
            aria-level={depth + 1}
            aria-posinset={siblingIndex + 1}
            aria-setsize={siblingCount}
            aria-expanded={planNode.children.length > 0 ? !collapsed : undefined}
            aria-selected={selected}
            aria-label={[planNode.name, ...planNode.subtext].join(", ")}
            tabIndex={selected ? 0 : -1}
            onFocus={() => focusSelection(planNode.id)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    data.closeTooltip();
                }
            }}
            onClick={(event) => activate(planNode.id, bounds(event))}
            onKeyDown={(event) => navigate(planNode.id, event, bounds(event))}>
            <Handle type="target" position={Position.Left} className="execution-plan-flow-handle" />
            <div className="execution-plan-flow-row-count">{planNode.rowCountDisplayString}</div>
            <div className="execution-plan-flow-icon-container">
                <img className="execution-plan-flow-icon" src={iconPath} alt="" draggable={false} />
                {planNode.badges.map((badge, index) => (
                    <img
                        key={`${badge.type}-${index}`}
                        className="execution-plan-flow-badge"
                        src={badgePath(badge.type)}
                        alt={badge.tooltip}
                        title={badge.tooltip}
                        draggable={false}
                    />
                ))}
            </div>
            <div className="execution-plan-flow-cost">{planNode.costDisplayString}</div>
            <div className="execution-plan-flow-label">
                {planNode.subtext.map((line, index) => (
                    <div key={index}>{line}</div>
                ))}
            </div>
            {planNode.children.length > 0 && (
                <button
                    type="button"
                    className="execution-plan-flow-collapse nodrag nopan"
                    tabIndex={selected ? 0 : -1}
                    aria-label={
                        collapsed
                            ? locConstants.executionPlan.expandNode(planNode.name)
                            : locConstants.executionPlan.collapseNode(planNode.name)
                    }
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapse(planNode.id);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleCollapse(planNode.id);
                        }
                    }}>
                    <img
                        src={collapsed ? collapseExpandPaths.expand : collapseExpandPaths.collapse}
                        alt=""
                        draggable={false}
                    />
                </button>
            )}
            <Handle
                type="source"
                position={Position.Right}
                className="execution-plan-flow-handle"
            />
        </div>
    );
}

const NODE_TYPES: NodeTypes = {
    executionPlan: ExecutionPlanReactFlowNode,
};

function ExecutionPlanReactFlowEdge({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style,
}: EdgeProps<ExecutionPlanFlowEdge>) {
    const configuredStrokeWidth =
        typeof style?.strokeWidth === "number"
            ? style.strokeWidth
            : Number.parseFloat(String(style?.strokeWidth ?? 1));
    const strokeWidth =
        Number.isFinite(configuredStrokeWidth) && configuredStrokeWidth > 0
            ? configuredStrokeWidth
            : 1;
    const arrowGeometry = getExecutionPlanClassicArrowGeometry(sourceX, sourceY, strokeWidth);
    const [edgePath] = getSmoothStepPath({
        sourceX: arrowGeometry.edgeSourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 0,
    });
    const stroke = "var(--vscode-editor-foreground)";

    return (
        <>
            <path
                d={edgePath}
                fill="none"
                stroke={stroke}
                className="react-flow__edge-path"
                style={style}
            />
            <path
                d={arrowGeometry.path}
                fill={stroke}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="miter"
                className="execution-plan-flow-arrow"
            />
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                className="react-flow__edge-interaction"
            />
        </>
    );
}

const EDGE_TYPES: EdgeTypes = {
    executionPlanEdge: ExecutionPlanReactFlowEdge,
};

interface ReactFlowExecutionPlanControllerOptions {
    model: ExecutionPlanModel;
    positions: ExecutionPlanNodePositions;
    instance: ReactFlowInstance<ExecutionPlanFlowNode, ExecutionPlanFlowEdge>;
    getSelectedId: () => string;
    getTooltipsEnabled: () => boolean;
    setTooltipsEnabled: (enabled: boolean) => void;
    setSelectedId: (id: string) => void;
    setHighlightedId: (id: string | undefined) => void;
    expandAncestors: (id: string) => void;
    focusNode: (id: string) => void;
    closeTooltip: () => void;
}

export class ReactFlowExecutionPlanController implements ExecutionPlanGraphController {
    public readonly expensiveMetricTypes: ReadonlySet<
        import("../../../sharedInterfaces/executionPlan").ExpensiveMetricType
    >;

    constructor(private readonly _options: ReactFlowExecutionPlanControllerOptions) {
        this.expensiveMetricTypes = _options.model.expensiveMetricTypes;
    }

    public getRoot(): ExecutionPlanNode {
        return this._options.model.root;
    }

    public getTotalRelativeCost(): number {
        return this._options.model.getTotalRelativeCost();
    }

    public getUniqueElementProperties(): string[] {
        return this._options.model.getUniqueElementProperties();
    }

    public getSelectedElement(): InternalExecutionPlanElement | undefined {
        return this.getElementById(this._options.getSelectedId());
    }

    public getElementById(id: string): InternalExecutionPlanElement | undefined {
        return this._options.model.getElement(id);
    }

    public toggleTooltip(): boolean {
        const enabled = !this._options.getTooltipsEnabled();
        this._options.setTooltipsEnabled(enabled);
        if (!enabled) {
            this._options.closeTooltip();
        }
        return enabled;
    }

    public zoomIn(): void {
        void this._options.instance.zoomIn({ duration: 150 });
    }

    public zoomOut(): void {
        void this._options.instance.zoomOut({ duration: 150 });
    }

    public zoomToFit(): void {
        void this._options.instance.fitView({ padding: 0.1, duration: 150 });
    }

    public getZoomLevel(): number {
        return this._options.instance.getZoom() * 100;
    }

    public setZoomLevel(level: number): void {
        void this._options.instance.zoomTo(Math.min(200, Math.max(1, level)) / 100, {
            duration: 150,
        });
    }

    public searchNodes(searchQuery: SearchQuery): ExecutionPlanNode[] {
        return this._options.model.searchNodes(searchQuery);
    }

    public centerElement(element: InternalExecutionPlanElement): void {
        const id = "name" in element ? element.id : (element as ExecutionPlanEdgeModel).targetId;
        const position = this._options.positions.get(id);
        if (!position) {
            return;
        }
        this._options.expandAncestors(id);
        void this._options.instance.setCenter(
            position.x + EXECUTION_PLAN_NODE_WIDTH / 2,
            position.y + EXECUTION_PLAN_NODE_HEIGHT / 2,
            {
                zoom: this._options.instance.getZoom(),
                duration: 150,
            },
        );
    }

    public selectElement(
        element: InternalExecutionPlanElement | undefined,
        bringToCenter?: boolean,
    ): void {
        const selectedElement = element ?? this._options.model.root;
        this._options.setSelectedId(selectedElement.id ?? this._options.model.root.id);
        if ("name" in selectedElement) {
            this._options.expandAncestors(selectedElement.id);
            this._options.focusNode(selectedElement.id);
        }
        if (bringToCenter) {
            this.centerElement(selectedElement);
        }
    }

    public clearExpensiveOperatorHighlighting(): void {
        this._options.setHighlightedId(undefined);
    }

    public highlightExpensiveOperator(
        predicate: (node: ExecutionPlanMetricSource) => number | undefined,
    ): string | undefined {
        const node = this._options.model.findMostExpensiveNode(predicate);
        this._options.setHighlightedId(node?.id);
        if (node) {
            this._options.expandAncestors(node.id);
        }
        return node?.id;
    }
}

interface ReactFlowExecutionPlanProps {
    root: ExecutionPlanNode;
    themeKind: ColorThemeKind;
    onReady: (controller: ExecutionPlanGraphController | null) => void;
}

export const ReactFlowExecutionPlan: React.FC<ReactFlowExecutionPlanProps> = ({
    root,
    themeKind,
    onReady,
}) => {
    const model = useMemo(() => new ExecutionPlanModel(root), [root]);
    const positions = useMemo(() => layoutExecutionPlan(model), [model]);
    const [instance, setInstance] =
        useState<ReactFlowInstance<ExecutionPlanFlowNode, ExecutionPlanFlowEdge>>();
    const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
    const [selectedId, setSelectedId] = useState(model.root.id);
    const [highlightedId, setHighlightedId] = useState<string>();
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
    const [tooltip, setTooltip] = useState<TooltipState>();
    const selectedIdRef = useRef(selectedId);
    const tooltipsEnabledRef = useRef(tooltipsEnabled);
    const nodeElementsRef = useRef(new Map<string, HTMLDivElement>());
    const canvasRef = useRef<HTMLDivElement>(null);

    const registerNodeElement = useCallback((id: string, element: HTMLDivElement | null) => {
        if (element) {
            nodeElementsRef.current.set(id, element);
        } else {
            nodeElementsRef.current.delete(id);
        }
    }, []);

    const focusNode = useCallback((id: string) => {
        let remainingFrames = EXECUTION_PLAN_FOCUS_RETRY_FRAMES;
        const focusWhenMounted = () => {
            if (selectedIdRef.current !== id) {
                return;
            }

            const element = nodeElementsRef.current.get(id);
            if (element) {
                element.focus({ preventScroll: true });
                if (document.activeElement === element) {
                    return;
                }
            }

            if (remainingFrames-- > 0) {
                requestAnimationFrame(focusWhenMounted);
            }
        };
        requestAnimationFrame(focusWhenMounted);
    }, []);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);
    useEffect(() => {
        tooltipsEnabledRef.current = tooltipsEnabled;
    }, [tooltipsEnabled]);

    const expandAncestors = useCallback(
        (id: string) => {
            const ancestorIds = model.getAncestorIds(id);
            setCollapsedNodeIds((current) => {
                const next = new Set(current);
                ancestorIds.forEach((ancestorId) => next.delete(ancestorId));
                return next.size === current.size ? current : next;
            });
        },
        [model],
    );

    const revealNode = useCallback(
        (id: string) => {
            const position = positions.get(id);
            const canvas = canvasRef.current;
            if (!instance || !position || !canvas) {
                return;
            }

            const viewport = getViewportToRevealExecutionPlanNode(
                instance.getViewport(),
                position,
                {
                    width: EXECUTION_PLAN_NODE_WIDTH,
                    height: EXECUTION_PLAN_NODE_HEIGHT,
                },
                {
                    width: canvas.clientWidth,
                    height: canvas.clientHeight,
                },
                EXECUTION_PLAN_REVEAL_PADDING,
            );
            if (viewport) {
                void instance.setViewport(viewport);
            }
        },
        [instance, positions],
    );

    const selectNode = useCallback(
        (id: string, reveal = false) => {
            expandAncestors(id);
            selectedIdRef.current = id;
            setSelectedId(id);
            if (reveal) {
                revealNode(id);
            }
            focusNode(id);
        },
        [expandAncestors, focusNode, revealNode],
    );

    const showNodeTooltip = useCallback(
        (id: string, bounds: DOMRect) => {
            if (!tooltipsEnabledRef.current) {
                setTooltip(undefined);
                return;
            }
            const node = model.getNode(id);
            if (node) {
                setTooltip({
                    content: formatExecutionPlanNodeTooltip(node),
                    x: bounds.right + 8,
                    y: bounds.top,
                });
            }
        },
        [model],
    );

    const activateNode = useCallback(
        (id: string, bounds: DOMRect) => {
            selectNode(id);
            showNodeTooltip(id, bounds);
        },
        [selectNode, showNodeTooltip],
    );

    const navigateNode = useCallback(
        (id: string, event: ReactKeyboardEvent<HTMLDivElement>, bounds: DOMRect) => {
            const node = model.getNode(id);
            if (!node) {
                return;
            }
            const parentId = model.getParentId(id);
            const siblings = parentId ? model.getChildIds(parentId) : [model.root.id];
            const siblingIndex = siblings.indexOf(id);
            let targetId: string | undefined;

            switch (event.key) {
                case "ArrowRight":
                    if (collapsedNodeIds.has(id)) {
                        event.preventDefault();
                        event.stopPropagation();
                        setTooltip(undefined);
                        return;
                    }
                    targetId = model.getChildIds(id)[0];
                    break;
                case "ArrowLeft":
                    targetId = parentId;
                    break;
                case "ArrowUp":
                    targetId = siblings[siblingIndex - 1];
                    break;
                case "ArrowDown":
                    targetId = siblings[siblingIndex + 1];
                    break;
                case "Enter":
                    event.preventDefault();
                    event.stopPropagation();
                    if (tooltip) {
                        setTooltip(undefined);
                    } else {
                        showNodeTooltip(id, bounds);
                    }
                    return;
                case "Escape":
                    event.preventDefault();
                    event.stopPropagation();
                    setTooltip(undefined);
                    return;
                default:
                    return;
            }

            event.preventDefault();
            event.stopPropagation();
            setTooltip(undefined);
            if (targetId) {
                selectNode(targetId, true);
            }
        },
        [collapsedNodeIds, model, selectNode, showNodeTooltip, tooltip],
    );

    const hiddenNodeIds = useMemo(
        () => getHiddenExecutionPlanElementIds(model, collapsedNodeIds),
        [collapsedNodeIds, model],
    );

    const nodes = useMemo<ExecutionPlanFlowNode[]>(
        () =>
            model.nodes.map((planNode) => {
                const parentId = model.getParentId(planNode.id);
                const siblings = parentId ? model.getChildIds(parentId) : [model.root.id];
                return {
                    id: planNode.id,
                    type: "executionPlan",
                    position: positions.get(planNode.id)!,
                    hidden: hiddenNodeIds.has(planNode.id),
                    selected: selectedId === planNode.id,
                    draggable: false,
                    connectable: false,
                    focusable: false,
                    width: EXECUTION_PLAN_NODE_WIDTH,
                    height: EXECUTION_PLAN_NODE_HEIGHT,
                    style: {
                        width: EXECUTION_PLAN_NODE_WIDTH,
                        height: EXECUTION_PLAN_NODE_HEIGHT,
                    },
                    data: {
                        planNode,
                        depth: model.getAncestorIds(planNode.id).length,
                        siblingIndex: siblings.indexOf(planNode.id),
                        siblingCount: siblings.length,
                        collapsed: collapsedNodeIds.has(planNode.id),
                        highlighted: highlightedId === planNode.id,
                        selected: selectedId === planNode.id,
                        themeKind,
                        registerElement: registerNodeElement,
                        closeTooltip: () => setTooltip(undefined),
                        focusSelection: (id: string) => {
                            selectedIdRef.current = id;
                            setSelectedId(id);
                        },
                        activate: activateNode,
                        navigate: navigateNode,
                        toggleCollapse: (id: string) => {
                            setCollapsedNodeIds((current) => {
                                const next = new Set(current);
                                if (next.has(id)) {
                                    next.delete(id);
                                } else {
                                    next.add(id);
                                }
                                return next;
                            });
                            setTooltip(undefined);
                        },
                    },
                };
            }),
        [
            activateNode,
            collapsedNodeIds,
            hiddenNodeIds,
            highlightedId,
            model,
            navigateNode,
            positions,
            registerNodeElement,
            selectedId,
            themeKind,
        ],
    );

    const edges = useMemo<ExecutionPlanFlowEdge[]>(
        () =>
            model.edges.map((edge) => ({
                id: edge.id,
                source: edge.sourceId,
                target: edge.targetId,
                type: "executionPlanEdge",
                hidden: hiddenNodeIds.has(edge.targetId),
                data: { ...edge },
                style: {
                    stroke: "var(--vscode-editor-foreground)",
                    strokeWidth: edge.weight,
                },
                focusable: false,
                selectable: true,
            })),
        [hiddenNodeIds, model],
    );

    useEffect(() => {
        if (!instance) {
            return;
        }
        const controller = new ReactFlowExecutionPlanController({
            model,
            positions,
            instance,
            getSelectedId: () => selectedIdRef.current,
            getTooltipsEnabled: () => tooltipsEnabledRef.current,
            setTooltipsEnabled: (enabled) => {
                tooltipsEnabledRef.current = enabled;
                setTooltipsEnabled(enabled);
            },
            setSelectedId: (id) => {
                selectedIdRef.current = id;
                setSelectedId(id);
            },
            setHighlightedId,
            expandAncestors,
            focusNode,
            closeTooltip: () => setTooltip(undefined),
        });
        onReady(controller);
        return () => onReady(null);
    }, [expandAncestors, focusNode, instance, model, onReady, positions]);

    return (
        <div
            ref={canvasRef}
            className="execution-plan-flow-canvas"
            role="tree"
            aria-label={locConstants.executionPlan.executionPlanGraph}>
            <ReactFlow<ExecutionPlanFlowNode, ExecutionPlanFlowEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                onInit={setInstance}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                minZoom={0.01}
                maxZoom={2}
                panOnDrag
                zoomOnScroll={false}
                zoomOnPinch
                zoomOnDoubleClick={false}
                preventScrolling={false}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                autoPanOnNodeFocus={false}
                edgesFocusable={false}
                disableKeyboardA11y
                onlyRenderVisibleElements
                selectionOnDrag={false}
                multiSelectionKeyCode={null}
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
                onPaneClick={() => setTooltip(undefined)}
                onEdgeClick={(event: MouseEvent, edge: ExecutionPlanFlowEdge) => {
                    if (tooltipsEnabledRef.current && edge.data) {
                        setTooltip({
                            content: formatExecutionPlanEdgeTooltip(edge.data),
                            x: event.clientX + 8,
                            y: event.clientY + 8,
                        });
                        focusNode(selectedIdRef.current);
                    }
                }}></ReactFlow>
            {tooltip && (
                <ExecutionPlanTooltip
                    tooltip={tooltip}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            setTooltip(undefined);
                            focusNode(selectedIdRef.current);
                        }
                    }}
                />
            )}
        </div>
    );
};

function ExecutionPlanTooltip({
    tooltip,
    onKeyDown,
}: {
    tooltip: TooltipState;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
    return (
        <div
            className="execution-plan-flow-tooltip"
            style={{
                left: `${Math.max(8, Math.min(tooltip.x, window.innerWidth - 560))}px`,
                top: `${Math.max(8, Math.min(tooltip.y, window.innerHeight - 180))}px`,
            }}
            role="tooltip"
            tabIndex={-1}
            onKeyDown={onKeyDown}>
            {tooltip.content.titleLines.length > 0 && (
                <div className="execution-plan-flow-tooltip-title">
                    {tooltip.content.titleLines.map((line, index) => (
                        <div key={index}>{line}</div>
                    ))}
                </div>
            )}
            {tooltip.content.description && (
                <div className="execution-plan-flow-tooltip-description">
                    {tooltip.content.description}
                </div>
            )}
            {tooltip.content.metrics.map((metric, index) => (
                <div
                    className={[
                        "execution-plan-flow-tooltip-metric",
                        metric.isSql ? "execution-plan-flow-tooltip-sql-metric" : "",
                    ]
                        .filter(Boolean)
                        .join(" ")}
                    key={`${metric.name}-${index}`}>
                    <span>{metric.name}</span>
                    <span>{metric.isSql ? <SqlText text={metric.value} /> : metric.value}</span>
                </div>
            ))}
            {tooltip.content.footer.map((metric, index) => (
                <div className="execution-plan-flow-tooltip-footer" key={`${metric.name}-${index}`}>
                    <strong>{metric.name}</strong>
                    {metric.isSql ? (
                        <SqlText className="execution-plan-flow-tooltip-sql" text={metric.value} />
                    ) : (
                        <div>{metric.value}</div>
                    )}
                </div>
            ))}
        </div>
    );
}
