/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Edge,
    EdgeLabelRenderer,
    EdgeProps,
    EdgeTypes,
    Handle,
    Node,
    NodeProps,
    NodeTypes,
    Position,
    ReactFlow,
    ReactFlowInstance,
    ReactFlowProvider,
    ViewportPortal,
    getSmoothStepPath,
} from "@xyflow/react";
import { Button } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent,
    ReactNode,
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
import {
    formatLiveExecutionPlanRows,
    getExecutionPlanNodeLabelLineCount,
    getExecutionPlanNodeLabelLines,
} from "./executionPlanLiveStatistics";
import { SqlText } from "../../common/sqlText";
import {
    ExecutionPlanGraphController,
    ExecutionPlanMetricSource,
} from "./executionPlanGraphController";
import { getExecutionPlanOperatorIcon } from "./executionPlanOperatorIcons";
import {
    EXECUTION_PLAN_GRAPH_PADDING,
    EXECUTION_PLAN_NODE_HEIGHT,
    EXECUTION_PLAN_NODE_WIDTH,
    EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
    ExecutionPlanEdgeModel,
    ExecutionPlanModel,
    ExecutionPlanNodePositions,
    advanceExecutionPlanEdgeFlow,
    EMPTY_EXECUTION_PLAN_EDGE_FLOW_STATE,
    ExecutionPlanEdgeFlowState,
    formatExecutionPlanRowCount,
    getHiddenExecutionPlanElementIds,
    layoutExecutionPlan,
} from "./executionPlanModel";
import { getExecutionPlanArrowGeometry } from "./executionPlanEdgeGeometry";
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
    ExecutionPlanBounds,
    ExecutionPlanViewport,
    getExecutionPlanWheelDelta,
    getViewportForExecutionPlanScroll,
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
const EXECUTION_PLAN_COMPARISON_GROUP_PADDING = 10;

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
    /** Matches the operator selected in another view, such as the other plan of a comparison. */
    linked: boolean;
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
    /** Rows the child operator sends along this edge, shown on the edge. */
    rowCountLabel?: { label: string; exact: string };
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
        linked,
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
    const labelLines = getExecutionPlanNodeLabelLines(planNode);
    const [renderedSelectionSize, setRenderedSelectionSize] = useState({
        width: selectionWidth,
        height: selectionHeight,
    });

    useLayoutEffect(() => {
        const label = labelRef.current;
        if (!label) {
            return;
        }

        const nextSize = planNode.liveQueryStatistics
            ? {
                  width: selectionWidth,
                  height: selectionHeight,
              }
            : {
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
                linked ? "linked" : "",
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
            aria-label={[planNode.name, ...labelLines].join(", ")}
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
            <div
                ref={labelRef}
                className="execution-plan-flow-label"
                title={formatLiveExecutionPlanRows(planNode, false)}>
                {labelLines.map((line, index) => (
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
    if (node.liveQueryStatistics) {
        return EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH;
    }
    const labelLines = getExecutionPlanNodeLabelLines(node);
    const fallbackWidth = Math.max(0, ...labelLines.map((line) => line.length * 6));
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
    const labelWidth = Math.max(0, ...labelLines.map((line) => context.measureText(line).width));
    return Math.min(
        EXECUTION_PLAN_MAXIMUM_LABEL_WIDTH,
        Math.max(EXECUTION_PLAN_NODE_WIDTH, Math.ceil(labelWidth) + 8),
    );
}

/**
 * The extent of the visible operators and their labels, in flow coordinates, with the graph's
 * padding around it.
 */
function getExecutionPlanBounds(
    model: ExecutionPlanModel,
    positions: ExecutionPlanNodePositions,
    hiddenNodeIds: ReadonlySet<string>,
): ExecutionPlanBounds {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of model.nodes) {
        const position = positions.get(node.id);
        if (!position || hiddenNodeIds.has(node.id)) {
            continue;
        }
        const width = Math.max(EXECUTION_PLAN_NODE_WIDTH, getNodeSelectionWidth(node));
        const nodeLeft = position.x + (EXECUTION_PLAN_NODE_WIDTH - width) / 2;
        left = Math.min(left, nodeLeft);
        right = Math.max(right, nodeLeft + width);
        top = Math.min(top, position.y);
        bottom = Math.max(bottom, position.y + getNodeSelectionHeight(node));
    }
    if (!Number.isFinite(left)) {
        return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    return {
        left: left - EXECUTION_PLAN_GRAPH_PADDING,
        top: top - EXECUTION_PLAN_GRAPH_PADDING,
        right: right + EXECUTION_PLAN_GRAPH_PADDING,
        bottom: bottom + EXECUTION_PLAN_GRAPH_PADDING,
    };
}

function getNodeSelectionHeight(node: ExecutionPlanNode): number {
    const labelHeight =
        EXECUTION_PLAN_LABEL_TOP +
        getExecutionPlanNodeLabelLineCount(node) * EXECUTION_PLAN_LABEL_LINE_HEIGHT +
        EXECUTION_PLAN_SELECTION_VERTICAL_PADDING;
    return Math.max(EXECUTION_PLAN_NODE_HEIGHT + 6, labelHeight);
}

/**
 * Where edges meet the operator icon, matching the handle positions in the stylesheet. Declaring
 * them lets React Flow keep drawing edges when a live refresh replaces the nodes, instead of
 * dropping them until it measures the handles again.
 */
const EXECUTION_PLAN_NODE_HANDLES: NonNullable<Node["handles"]> = [
    { type: "target", position: Position.Left, x: 22.5, y: 31.5, width: 1, height: 1 },
    { type: "source", position: Position.Right, x: 56.5, y: 31.5, width: 1, height: 1 },
];

/** Corner radius where an edge turns between operators. */
const EXECUTION_PLAN_EDGE_CORNER_RADIUS = 8;

/** Space between an edge's row count label and the child operator it comes from. */
const EXECUTION_PLAN_ROW_COUNT_LABEL_GAP = 6;

/** Length of one cycle of the live flow dashes. Matches the animation in the stylesheet. */
const EXECUTION_PLAN_FLOW_CYCLE_MS = 800;

/** Live flow stays thin regardless of the number of rows moving along the edge. */
const EXECUTION_PLAN_FLOW_WIDTH = 1;

function ExecutionPlanFlowDashes({ path }: { path: string }) {
    // Phase every flow from a shared clock, so an edge that starts flowing or remounts after a
    // refresh joins the motion where it already is instead of restarting it.
    const [animationDelay] = useState(
        () => `-${Math.round(performance.now() % EXECUTION_PLAN_FLOW_CYCLE_MS)}ms`,
    );
    return (
        <path
            d={path}
            fill="none"
            className="execution-plan-flow-dashes"
            style={{
                animationDelay,
                strokeWidth: EXECUTION_PLAN_FLOW_WIDTH,
            }}
        />
    );
}

function ExecutionPlanReactFlowEdge({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style,
    animated,
    data,
}: EdgeProps<ExecutionPlanFlowEdge>) {
    const arrowGeometry = getExecutionPlanArrowGeometry(sourceX, sourceY);
    const [edgePath] = getSmoothStepPath({
        sourceX: arrowGeometry.edgeSourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: EXECUTION_PLAN_EDGE_CORNER_RADIUS,
    });
    // The flow starts at the handle, which stays put as the edge thickens and its arrowhead grows,
    // so the dashes never jump. The arrowhead is drawn over the start.
    const [flowPath] = animated
        ? getSmoothStepPath({
              sourceX,
              sourceY,
              sourcePosition,
              targetX,
              targetY,
              targetPosition,
              borderRadius: EXECUTION_PLAN_EDGE_CORNER_RADIUS,
          })
        : [undefined];

    // The stylesheet sets the color, so the edge and its arrowhead change together on hover
    return (
        <g className="execution-plan-flow-edge">
            <path d={edgePath} fill="none" className="react-flow__edge-path" style={style} />
            {flowPath && <ExecutionPlanFlowDashes path={flowPath} />}
            <path
                d={arrowGeometry.path}
                fill="currentColor"
                className="execution-plan-flow-arrow"
            />
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                className="react-flow__edge-interaction"
            />
            {data?.rowCountLabel && (
                // The label ends just before the child, on the last stretch of the edge, which
                // no other edge shares and no arrowhead covers. Like the edge, pressing it
                // doesn't pan the plan.
                <EdgeLabelRenderer>
                    <div
                        className="execution-plan-flow-row-count nopan"
                        title={data.rowCountLabel.exact}
                        aria-hidden="true"
                        style={{
                            transform: `translate(-100%, -50%) translate(${targetX - EXECUTION_PLAN_ROW_COUNT_LABEL_GAP}px, ${targetY}px)`,
                        }}>
                        {data.rowCountLabel.label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </g>
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
    isNodeInView: (id: string) => boolean;
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
        this.setTooltipsEnabled(enabled);
        return enabled;
    }

    public setTooltipsEnabled(enabled: boolean): void {
        this._options.setTooltipsEnabled(enabled);
        if (!enabled) {
            this._options.closeTooltip();
        }
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

    public getViewport(): ExecutionPlanViewport {
        return this._options.instance.getViewport();
    }

    public setViewport(viewport: ExecutionPlanViewport): void {
        void this._options.instance.setViewport(viewport);
    }

    public isElementInView(element: InternalExecutionPlanElement): boolean {
        const id = "name" in element ? element.id : (element as ExecutionPlanEdgeModel).targetId;
        return this._options.isNodeInView(id);
    }

    public getElementCenter(
        element: InternalExecutionPlanElement,
    ): { x: number; y: number } | undefined {
        const id = "name" in element ? element.id : (element as ExecutionPlanEdgeModel).targetId;
        const position = this._options.positions.get(id);
        return (
            position && {
                x: position.x + EXECUTION_PLAN_NODE_WIDTH / 2,
                y: position.y + EXECUTION_PLAN_NODE_HEIGHT / 2,
            }
        );
    }

    public centerAt(point: { x: number; y: number }): void {
        void this._options.instance.setCenter(point.x, point.y, {
            zoom: this._options.instance.getZoom(),
            duration: 150,
        });
    }

    public revealElement(element: InternalExecutionPlanElement): void {
        const id = "name" in element ? element.id : (element as ExecutionPlanEdgeModel).targetId;
        this._options.expandAncestors(id);
        if (!this._options.isNodeInView(id)) {
            this.centerElement(element);
        }
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
        focus = true,
    ): void {
        const selectedElement = element ?? this._options.model.root;
        this._options.setSelectedId(selectedElement.id ?? this._options.model.root.id);
        if ("name" in selectedElement) {
            this._options.expandAncestors(selectedElement.id);
            if (focus) {
                this._options.focusNode(selectedElement.id);
            }
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
    /** The plan of a running statement, refreshed with live row counts. */
    isLive?: boolean;
    /** Number of the live read the plan came from. */
    liveRefreshId?: number;
    themeKind: ColorThemeKind;
    planNumber: number;
    onReady: (controller: ExecutionPlanGraphController | null) => void;
    /** Roots of the similar areas to outline, each mapped to the color slot of its area. */
    comparisonGroupRoots?: ReadonlyMap<string, number>;
    /** Called with the selected node id, including programmatic selection changes. */
    onSelectionChange?: (id: string) => void;
    /** An operator to outline as the match of the one selected in another view. */
    linkedNodeId?: string;
    /** Called as the view moves or zooms, whether the user or code moved it. */
    onViewportChange?: (viewport: ExecutionPlanViewport) => void;
    /**
     * Controls drawn over the canvas, such as React Flow's Controls panel. They render outside
     * the tree of operators, which may own only tree items, and can read React Flow's store. An
     * operator under any of them does not count as in view.
     */
    overlay?: ReactNode;
}

export const ReactFlowExecutionPlan: React.FC<ReactFlowExecutionPlanProps> = ({
    root,
    isLive = false,
    liveRefreshId,
    themeKind,
    planNumber,
    onReady,
    comparisonGroupRoots,
    onSelectionChange,
    linkedNodeId,
    onViewportChange,
    overlay,
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
    const [focusAnnouncement, setFocusAnnouncement] = useState("");
    const selectedIdRef = useRef(selectedId);
    const tooltipsEnabledRef = useRef(tooltipsEnabled);
    const nodeElementsRef = useRef(new Map<string, HTMLDivElement>());
    const canvasRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

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
        onSelectionChange?.(selectedId);
    }, [onSelectionChange, selectedId]);
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

    /** Whether a node is on the canvas and not hidden under anything drawn over it. */
    const isNodeInView = useCallback(
        (id: string) => {
            const position = positions.get(id);
            const canvas = canvasRef.current;
            if (!instance || !position || !canvas) {
                return true;
            }
            const onCanvas =
                getViewportToRevealExecutionPlanNode(
                    instance.getViewport(),
                    position,
                    { width: EXECUTION_PLAN_NODE_WIDTH, height: EXECUTION_PLAN_NODE_HEIGHT },
                    { width: canvas.clientWidth, height: canvas.clientHeight },
                    EXECUTION_PLAN_REVEAL_PADDING,
                ) === undefined;
            const element = nodeElementsRef.current.get(id);
            if (!onCanvas || !element || !overlayRef.current) {
                return onCanvas;
            }
            const node = element.getBoundingClientRect();
            // The overlay lays out its children over the canvas, so each one can cover the node.
            return ![...overlayRef.current.children].some((cover) => {
                const bounds = cover.getBoundingClientRect();
                return (
                    node.left < bounds.right &&
                    bounds.left < node.right &&
                    node.top < bounds.bottom &&
                    bounds.top < node.bottom
                );
            });
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
                        y: bounds.bottom + 8,
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
                    if (!collapsedNodeIds.has(id)) {
                        targetId = model.getChildIds(id)[0];
                    }
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

    const planBounds = useMemo(
        () => getExecutionPlanBounds(model, positions, hiddenNodeIds),
        [hiddenNodeIds, model, positions],
    );
    const planBoundsRef = useRef(planBounds);
    useEffect(() => {
        planBoundsRef.current = planBounds;
    }, [planBounds]);

    // The wheel scrolls the plan like a scroll area and hands off to the page at the plan's edges,
    // so the page still scrolls between stacked plans. The listener isn't passive, so it can claim
    // the wheel when the plan moves.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!instance || !canvas) {
            return;
        }
        const handleWheel = (event: WheelEvent) => {
            // Pinch gestures arrive as ctrl+wheel and zoom through React Flow; tooltips scroll
            // their own content
            if (
                event.ctrlKey ||
                (event.target instanceof Element &&
                    event.target.closest(".execution-plan-flow-tooltip"))
            ) {
                return;
            }
            const canvasSize = { width: canvas.clientWidth, height: canvas.clientHeight };
            const viewport = getViewportForExecutionPlanScroll(
                instance.getViewport(),
                getExecutionPlanWheelDelta(event, canvasSize),
                planBoundsRef.current,
                canvasSize,
            );
            if (viewport) {
                event.preventDefault();
                void instance.setViewport(viewport);
            }
        };
        canvas.addEventListener("wheel", handleWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", handleWheel);
    }, [instance]);

    // Rows are moving along an edge whose row count grew recently. The flow state carries across
    // refreshes so an edge keeps animating through reads that find no new rows.
    const edgeFlowStateRef = useRef<ExecutionPlanEdgeFlowState>(
        EMPTY_EXECUTION_PLAN_EDGE_FLOW_STATE,
    );
    // Advance once per live read. Other state updates resend the same read, and counting those as
    // reads would stop edges that are still flowing.
    const edgeFlow = useMemo(
        () => advanceExecutionPlanEdgeFlow(model.edges, edgeFlowStateRef.current, isLive),
        [isLive, liveRefreshId],
    );
    useEffect(() => {
        edgeFlowStateRef.current = edgeFlow.state;
    }, [edgeFlow]);
    const flowingEdgeIds = edgeFlow.flowingEdgeIds;

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
                    measured: {
                        width: EXECUTION_PLAN_NODE_WIDTH,
                        height: EXECUTION_PLAN_NODE_HEIGHT,
                    },
                    handles: EXECUTION_PLAN_NODE_HANDLES,
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
                        linked: linkedNodeId === planNode.id,
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
            linkedNodeId,
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
                animated: flowingEdgeIds.has(edge.id),
                data: {
                    ...edge,
                    rowCountLabel: formatExecutionPlanRowCount(
                        model.getNode(edge.targetId)?.rowCountDisplayString ?? "",
                    ),
                },
                style: {
                    strokeWidth: edge.weight,
                },
                focusable: false,
                selectable: true,
            })),
        [flowingEdgeIds, hiddenNodeIds, model],
    );

    const comparisonGroups = useMemo(() => {
        const groups: {
            id: string;
            colorSlot: number;
            x: number;
            y: number;
            width: number;
            height: number;
        }[] = [];
        for (const [rootId, colorSlot] of comparisonGroupRoots ?? []) {
            if (!positions.has(rootId) || hiddenNodeIds.has(rootId)) {
                continue;
            }
            const memberIds: string[] = [];
            const visit = (id: string) => {
                if (hiddenNodeIds.has(id)) {
                    return;
                }
                memberIds.push(id);
                model.getChildIds(id).forEach(visit);
            };
            visit(rootId);
            const memberBounds = memberIds
                .map((id) => {
                    const position = positions.get(id);
                    const node = model.getNode(id);
                    if (!position || !node) {
                        return undefined;
                    }
                    const width = getNodeSelectionWidth(node);
                    return {
                        left: position.x - (width - EXECUTION_PLAN_NODE_WIDTH) / 2,
                        top: position.y + EXECUTION_PLAN_SELECTION_TOP_OFFSET,
                        right:
                            position.x +
                            EXECUTION_PLAN_NODE_WIDTH +
                            (width - EXECUTION_PLAN_NODE_WIDTH) / 2,
                        bottom:
                            position.y +
                            EXECUTION_PLAN_SELECTION_TOP_OFFSET +
                            getNodeSelectionHeight(node),
                    };
                })
                .filter((bounds) => bounds !== undefined);
            if (memberBounds.length === 0) {
                continue;
            }
            const left =
                Math.min(...memberBounds.map((bounds) => bounds.left)) -
                EXECUTION_PLAN_COMPARISON_GROUP_PADDING;
            const top =
                Math.min(...memberBounds.map((bounds) => bounds.top)) -
                EXECUTION_PLAN_COMPARISON_GROUP_PADDING;
            const right =
                Math.max(...memberBounds.map((bounds) => bounds.right)) +
                EXECUTION_PLAN_COMPARISON_GROUP_PADDING;
            const bottom =
                Math.max(...memberBounds.map((bounds) => bounds.bottom)) +
                EXECUTION_PLAN_COMPARISON_GROUP_PADDING;
            groups.push({
                id: rootId,
                colorSlot,
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            });
        }
        return groups;
    }, [comparisonGroupRoots, hiddenNodeIds, model, positions]);

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
            isNodeInView,
            closeTooltip: () => setTooltip(undefined),
        });
        onReady(controller);
        return () => onReady(null);
    }, [expandAncestors, focusNode, instance, isNodeInView, model, onReady, positions]);

    return (
        <ReactFlowProvider>
            <div
                className="execution-plan-flow-announcement"
                role="status"
                aria-live="polite"
                aria-atomic="true">
                {focusAnnouncement}
            </div>
            <div
                ref={canvasRef}
                className="execution-plan-flow-canvas"
                role="tree"
                aria-label={locConstants.executionPlan.executionPlanGraph(planNumber)}
                onFocusCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                        setFocusAnnouncement(
                            locConstants.executionPlan.executionPlanGraph(planNumber),
                        );
                    }
                }}
                onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                        setFocusAnnouncement("");
                    }
                }}>
                <ReactFlow<ExecutionPlanFlowNode, ExecutionPlanFlowEdge>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    onInit={setInstance}
                    onMove={(_event, viewport) => onViewportChange?.(viewport)}
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
                    }}>
                    {comparisonGroups.length > 0 && (
                        <ViewportPortal>
                            {comparisonGroups.map((group) => (
                                <div
                                    key={group.id}
                                    className={`execution-plan-comparison-group execution-plan-comparison-group-${group.colorSlot}`}
                                    style={{
                                        transform: `translate(${group.x}px, ${group.y}px)`,
                                        width: group.width,
                                        height: group.height,
                                    }}
                                    aria-hidden
                                />
                            ))}
                        </ViewportPortal>
                    )}
                </ReactFlow>
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
            <div ref={overlayRef} className="execution-plan-flow-overlay">
                {overlay}
            </div>
        </ReactFlowProvider>
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
