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
import { Button } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
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
import { getExecutionPlanOperatorIcon } from "./executionPlanOperatorIcons";
import {
    EXECUTION_PLAN_NODE_HEIGHT,
    EXECUTION_PLAN_NODE_WIDTH,
    EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
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
import {
    ExecutionPlanTooltipSourceBounds,
    fitExecutionPlanTooltipPlacement,
    getExecutionPlanTooltipPlacement,
} from "./executionPlanTooltipPosition";
import {
    getViewportForExecutionPlanZoom,
    getViewportToRevealExecutionPlanNode,
} from "./executionPlanViewport";
import { getBadgePaths, getCollapseExpandPaths } from "./queryPlanSetup";

const EXECUTION_PLAN_REVEAL_PADDING = 0;
const EXECUTION_PLAN_FOCUS_RETRY_FRAMES = 20;
const EXECUTION_PLAN_LABEL_TOP = 49;
const EXECUTION_PLAN_LABEL_LINE_HEIGHT = 14;
const EXECUTION_PLAN_SELECTION_VERTICAL_PADDING = 10;
const EXECUTION_PLAN_SELECTION_TOP_OFFSET = -1;

interface TooltipState {
    targetId: string;
    content: ExecutionPlanTooltipContent;
    x: number;
    y: number;
    sourceBounds?: ExecutionPlanTooltipSourceBounds;
}

interface ExecutionPlanFlowNodeData extends Record<string, unknown> {
    planNode: ExecutionPlanNode;
    depth: number;
    siblingIndex: number;
    siblingCount: number;
    collapsed: boolean;
    highlighted: boolean;
    selected: boolean;
    selectionWidth: number;
    selectionHeight: number;
    themeKind: ColorThemeKind;
    registerElement: (id: string, element: HTMLDivElement | null) => void;
    focusSelection: (id: string) => void;
    closeTooltip: () => void;
    activate: (id: string, bounds: ExecutionPlanTooltipSourceBounds) => void;
    navigate: (
        id: string,
        event: ReactKeyboardEvent<HTMLDivElement>,
        bounds: ExecutionPlanTooltipSourceBounds,
    ) => void;
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
        selectionWidth,
        selectionHeight,
        themeKind,
        registerElement,
        focusSelection,
        activate,
        navigate,
        toggleCollapse,
    } = data;
    const badgePaths = getBadgePaths();
    const collapseExpandPaths = getCollapseExpandPaths(themeKind);
    const OperatorIcon = getExecutionPlanOperatorIcon(planNode.type);
    const labelRef = useRef<HTMLDivElement>(null);
    const [renderedSelectionSize, setRenderedSelectionSize] = useState({
        width: selectionWidth,
        height: selectionHeight,
    });

    useLayoutEffect(() => {
        const label = labelRef.current;
        if (!label) {
            return;
        }

        const nextSize = {
            width: Math.min(
                EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
                Math.max(EXECUTION_PLAN_NODE_WIDTH, Math.ceil(label.scrollWidth) + 8),
            ),
            height: Math.max(
                EXECUTION_PLAN_NODE_HEIGHT + 8,
                label.offsetTop +
                    Math.ceil(label.scrollHeight) +
                    EXECUTION_PLAN_SELECTION_VERTICAL_PADDING,
            ),
        };
        setRenderedSelectionSize((currentSize) =>
            currentSize.width === nextSize.width && currentSize.height === nextSize.height
                ? currentSize
                : nextSize,
        );
    }, [planNode, selectionHeight, selectionWidth]);

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
    const bounds = (event: {
        currentTarget: EventTarget & HTMLElement;
    }): ExecutionPlanTooltipSourceBounds => {
        const cellBounds = event.currentTarget.getBoundingClientRect();
        const horizontalOverflow = Math.max(
            0,
            (renderedSelectionSize.width - cellBounds.width) / 2,
        );
        const selectionTop = cellBounds.top + EXECUTION_PLAN_SELECTION_TOP_OFFSET;
        return {
            left: cellBounds.left - horizontalOverflow,
            right: cellBounds.right + horizontalOverflow,
            top: selectionTop,
            bottom: selectionTop + renderedSelectionSize.height,
        };
    };

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
                const nextElement = event.relatedTarget;
                const movingToTooltip =
                    nextElement instanceof HTMLElement &&
                    nextElement.closest(".execution-plan-flow-tooltip") !== null;
                if (!event.currentTarget.contains(nextElement) && !movingToTooltip) {
                    data.closeTooltip();
                }
            }}
            onClick={(event) => activate(planNode.id, bounds(event))}
            onKeyDown={(event) => navigate(planNode.id, event, bounds(event))}>
            <div
                className="execution-plan-flow-selection-outline"
                style={{
                    width: renderedSelectionSize.width,
                    height: renderedSelectionSize.height,
                }}
                aria-hidden="true"
            />
            <Handle type="target" position={Position.Left} className="execution-plan-flow-handle" />
            <div className="execution-plan-flow-row-count">{planNode.rowCountDisplayString}</div>
            <div className="execution-plan-flow-icon-container">
                <OperatorIcon className="execution-plan-flow-icon" />
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
            <div ref={labelRef} className="execution-plan-flow-label">
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

let nodeLabelMeasurementCanvas: HTMLCanvasElement | undefined;

function getNodeSelectionWidth(node: ExecutionPlanNode): number {
    const fallbackWidth = Math.max(0, ...node.subtext.map((line) => line.length * 6));
    if (typeof document === "undefined") {
        return Math.min(
            EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
            Math.max(EXECUTION_PLAN_NODE_WIDTH, fallbackWidth + 8),
        );
    }

    nodeLabelMeasurementCanvas ??= document.createElement("canvas");
    const context = nodeLabelMeasurementCanvas.getContext("2d");
    if (!context) {
        return Math.min(
            EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
            Math.max(EXECUTION_PLAN_NODE_WIDTH, fallbackWidth + 8),
        );
    }

    context.font = "10px Monaco, Menlo, Consolas, monospace";
    const labelWidth = Math.max(0, ...node.subtext.map((line) => context.measureText(line).width));
    return Math.min(
        EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
        Math.max(EXECUTION_PLAN_NODE_WIDTH, Math.ceil(labelWidth) + 8),
    );
}

function getNodeSelectionHeight(node: ExecutionPlanNode): number {
    const labelHeight =
        EXECUTION_PLAN_LABEL_TOP +
        Math.max(1, node.subtext.length) * EXECUTION_PLAN_LABEL_LINE_HEIGHT +
        EXECUTION_PLAN_SELECTION_VERTICAL_PADDING;
    return Math.max(EXECUTION_PLAN_NODE_HEIGHT + 6, labelHeight);
}

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

    private setAnchoredZoom(zoom: number): void {
        const viewport = getViewportForExecutionPlanZoom(
            this._options.instance.getViewport(),
            Math.min(2, Math.max(0.01, zoom)),
        );
        if (viewport) {
            void this._options.instance.setViewport(viewport, { duration: 150 });
        }
    }

    public zoomIn(): void {
        this.setAnchoredZoom(this._options.instance.getZoom() * 1.2);
    }

    public zoomOut(): void {
        this.setAnchoredZoom(this._options.instance.getZoom() / 1.2);
    }

    public zoomToFit(): void {
        void this._options.instance.fitView({ padding: 0.1, duration: 150 });
    }

    public getZoomLevel(): number {
        return this._options.instance.getZoom() * 100;
    }

    public setZoomLevel(level: number): void {
        this.setAnchoredZoom(Math.min(200, Math.max(1, level)) / 100);
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
        (id: string, bounds: ExecutionPlanTooltipSourceBounds) => {
            if (!tooltipsEnabledRef.current) {
                setTooltip(undefined);
                return;
            }
            const node = model.getNode(id);
            if (node) {
                const targetId = `node:${id}`;
                setTooltip((current) => {
                    if (current?.targetId === targetId) {
                        return undefined;
                    }
                    return {
                        targetId,
                        content: formatExecutionPlanNodeTooltip(node),
                        x: bounds.right + 8,
                        y: bounds.top,
                        sourceBounds: {
                            left: bounds.left,
                            right: bounds.right,
                            top: bounds.top,
                            bottom: bounds.bottom,
                        },
                    };
                });
            }
        },
        [model],
    );

    const activateNode = useCallback(
        (id: string, bounds: ExecutionPlanTooltipSourceBounds) => {
            selectNode(id);
            showNodeTooltip(id, bounds);
        },
        [selectNode, showNodeTooltip],
    );

    const navigateNode = useCallback(
        (
            id: string,
            event: ReactKeyboardEvent<HTMLDivElement>,
            bounds: ExecutionPlanTooltipSourceBounds,
        ) => {
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
                    showNodeTooltip(id, bounds);
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
        [collapsedNodeIds, model, selectNode, showNodeTooltip],
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
                        selectionWidth: getNodeSelectionWidth(planNode),
                        selectionHeight: getNodeSelectionHeight(planNode),
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
                    const edgeData = edge.data;
                    if (tooltipsEnabledRef.current && edgeData) {
                        const targetId = `edge:${edge.id}`;
                        setTooltip((current) => {
                            if (current?.targetId === targetId) {
                                return undefined;
                            }
                            return {
                                targetId,
                                content: formatExecutionPlanEdgeTooltip(edgeData),
                                x: event.clientX + 8,
                                y: event.clientY + 8,
                            };
                        });
                        focusNode(selectedIdRef.current);
                    }
                }}></ReactFlow>
            {tooltip && (
                <ExecutionPlanTooltip
                    tooltip={tooltip}
                    onClose={() => {
                        setTooltip(undefined);
                        focusNode(selectedIdRef.current);
                    }}
                />
            )}
        </div>
    );
};

function ExecutionPlanTooltip({
    tooltip,
    onClose,
}: {
    tooltip: TooltipState;
    onClose: () => void;
}) {
    const titleId = useId();
    const tooltipRef = useRef<HTMLDivElement>(null);
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
    };
    const placement = getExecutionPlanTooltipPlacement(tooltip, viewport);

    useLayoutEffect(() => {
        const element = tooltipRef.current;
        if (!element) {
            return;
        }

        // Measure without a constraint first so scrolling is enabled only when
        // the tooltip's natural height cannot fit inside the viewport.
        element.style.maxHeight = "";
        element.style.overflowY = "hidden";
        const naturalHeight = element.scrollHeight;
        const fittedPlacement = fitExecutionPlanTooltipPlacement(
            placement,
            { width: element.offsetWidth, height: naturalHeight },
            viewport,
        );
        element.style.left = `${fittedPlacement.left}px`;
        element.style.top = `${fittedPlacement.top}px`;
        if (naturalHeight > fittedPlacement.maxHeight) {
            element.style.maxHeight = `${fittedPlacement.maxHeight}px`;
            element.style.overflowY = "auto";
        }
    }, [placement.left, placement.top, tooltip.targetId, viewport.height, viewport.width]);

    return (
        <div
            ref={tooltipRef}
            className="execution-plan-flow-tooltip"
            style={{
                left: `${placement.left}px`,
                top: `${placement.top}px`,
            }}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }
            }}>
            <div className="execution-plan-flow-tooltip-header">
                <div id={titleId} className="execution-plan-flow-tooltip-title">
                    {tooltip.content.titleLines.length === 0 && (
                        <div>{locConstants.executionPlan.executionPlanDetails}</div>
                    )}
                    {tooltip.content.titleLines.map((line, index) => (
                        <div key={index}>{line}</div>
                    ))}
                </div>
                <Button
                    className="execution-plan-flow-tooltip-close"
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular />}
                    title={locConstants.common.close}
                    aria-label={locConstants.common.close}
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                />
            </div>
            <div className="execution-plan-flow-tooltip-body">
                {tooltip.content.description && (
                    <div className="execution-plan-flow-tooltip-description">
                        {tooltip.content.description}
                    </div>
                )}
                {tooltip.content.metrics.length > 0 && (
                    <dl className="execution-plan-flow-tooltip-metrics">
                        {tooltip.content.metrics.map((metric, index) => (
                            <div
                                className={[
                                    "execution-plan-flow-tooltip-metric",
                                    metric.isSql ? "execution-plan-flow-tooltip-sql-metric" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                key={`${metric.name}-${index}`}>
                                <dt>{metric.name}</dt>
                                <dd>
                                    {metric.isSql ? <SqlText text={metric.value} /> : metric.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
                {tooltip.content.footer.map((metric, index) => (
                    <div
                        className="execution-plan-flow-tooltip-footer"
                        key={`${metric.name}-${index}`}>
                        <strong>{metric.name}</strong>
                        {metric.isSql ? (
                            <SqlText
                                className="execution-plan-flow-tooltip-sql"
                                text={metric.value}
                            />
                        ) : (
                            <div>{metric.value}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
