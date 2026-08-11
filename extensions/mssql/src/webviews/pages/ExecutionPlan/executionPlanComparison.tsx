/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlanComparison.css";

import {
    Button,
    Dropdown,
    Input,
    Option,
    Spinner,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    tokens,
} from "@fluentui/react-components";
import {
    AddSquareRegular,
    ArrowSyncRegular,
    ChevronDown16Regular,
    ChevronLeft16Regular,
    ChevronRight16Regular,
    Dismiss16Regular,
    DocumentAddRegular,
    DocumentBulletListFilled,
    DocumentBulletListRegular,
    SplitHorizontalRegular,
    SplitVerticalRegular,
    ZoomFitRegular,
    ZoomInRegular,
    ZoomOutRegular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Viewport } from "@xyflow/react";
import {
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    ExecutionPlanComparisonSource,
    ExecutionPlanGraph,
    ExecutionPlanNode,
} from "../../../sharedInterfaces/executionPlan";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import {
    SearchPlanIcon,
    TooltipIcon16Regular,
    TooltipOffIcon16Regular,
    ZoomOriginalSizeIcon16Regular,
} from "../../common/icons/executionPlanIcons";
import { locConstants } from "../../common/locConstants";
import { SqlText } from "../../common/sqlText";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewErrorBoundary } from "../../common/webviewErrorBoundary";
import {
    buildExecutionPlanComparisonMaps,
    buildExecutionPlanComparisonPropertyRows,
    ExecutionPlanComparisonPropertyRow,
} from "./executionPlanComparisonModel";
import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { normalizeExecutionPlanQuery } from "./executionPlanQuery";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { useExecutionPlanSelector } from "./executionPlanSelector";
import { FindNode } from "./findNodes";
import { ReactFlowExecutionPlan } from "./reactFlowExecutionPlan";

type ComparisonOrientation = "horizontal" | "vertical";
type ComparisonSide = "primary" | "secondary";
type PropertySort = "importance" | "alphabetical" | "reverseAlphabetical";

function graphCostPercentage(source: ExecutionPlanComparisonSource, graph: ExecutionPlanGraph) {
    const total = source.graphs.reduce(
        (sum, candidate) => sum + candidate.root.cost + candidate.root.subTreeCost,
        0,
    );
    return total > 0
        ? (((graph.root.cost + graph.root.subTreeCost) / total) * 100).toFixed(2)
        : "0.00";
}

interface ComparisonPlanPaneProps {
    side: ComparisonSide;
    source: ExecutionPlanComparisonSource;
    groupRoots: ReadonlyMap<string, number>;
    viewport: Viewport | undefined;
    onViewportChange: (viewport: Viewport) => void;
    onReady: (controller: ExecutionPlanGraphController | null) => void;
    onSelectionChange: (node: ExecutionPlanNode) => void;
    showFind: boolean;
    onCloseFind: () => void;
    onSelectGraph: (index: number) => void;
}

function ComparisonPlanPane({
    side,
    source,
    groupRoots,
    viewport,
    onViewportChange,
    onReady,
    onSelectionChange,
    showFind,
    onCloseFind,
    onSelectGraph,
}: ComparisonPlanPaneProps) {
    const { themeKind, extensionRpc } = useVscodeWebview();
    const graph = source.graphs[source.selectedGraphIndex];
    const [controller, setController] = useState<ExecutionPlanGraphController | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const handleReady = useCallback(
        (nextController: ExecutionPlanGraphController | null) => {
            setController(nextController);
            onReady(nextController);
        },
        [onReady],
    );

    useEffect(() => {
        if (showFind) {
            inputRef.current?.focus();
        }
    }, [showFind]);

    if (!graph) {
        return undefined;
    }

    const query = normalizeExecutionPlanQuery(graph.query);
    const queryCost = locConstants.executionPlan.queryCostRelativeToScript(
        source.selectedGraphIndex + 1,
        graphCostPercentage(source, graph),
    );

    return (
        <section
            className="execution-plan-comparison-pane"
            aria-label={
                side === "primary"
                    ? locConstants.executionPlan.primaryPlan
                    : locConstants.executionPlan.addedPlan
            }>
            <div className="execution-plan-comparison-pane-header">
                <div className="execution-plan-comparison-source-row">
                    <span className="execution-plan-comparison-source-name">
                        {source.sourceName}
                    </span>
                    {source.graphs.length > 1 && (
                        <Dropdown
                            size="small"
                            value={locConstants.executionPlan.statementNumber(
                                source.selectedGraphIndex + 1,
                            )}
                            selectedOptions={[String(source.selectedGraphIndex)]}
                            aria-label={locConstants.executionPlan.selectStatement}
                            onOptionSelect={(_, data) => onSelectGraph(Number(data.optionValue))}>
                            {source.graphs.map((_, index) => (
                                <Option
                                    key={index}
                                    value={String(index)}
                                    text={locConstants.executionPlan.statementNumber(index + 1)}>
                                    {locConstants.executionPlan.statementNumber(index + 1)}
                                </Option>
                            ))}
                        </Dropdown>
                    )}
                </div>
                <div className="execution-plan-comparison-cost">{queryCost}</div>
                <SqlText
                    className="execution-plan-comparison-query"
                    text={query}
                    singleLine
                    showLineBreaks
                    title={query}
                />
            </div>
            <div className="execution-plan-comparison-graph">
                <WebviewErrorBoundary
                    fallback={
                        <div role="alert" className="execution-plan-comparison-render-error">
                            {locConstants.executionPlan.reactFlowRendererError}
                        </div>
                    }
                    onError={(error, errorInfo) => {
                        onReady(null);
                        extensionRpc.log.error(
                            `React Flow ${side} comparison renderer failed`,
                            error,
                            errorInfo.componentStack,
                        );
                    }}>
                    <ReactFlowExecutionPlan
                        key={`${side}-${source.selectedGraphIndex}`}
                        root={graph.root}
                        themeKind={themeKind}
                        onReady={handleReady}
                        comparisonGroupRoots={groupRoots}
                        onSelectionChange={onSelectionChange}
                        viewport={viewport}
                        onViewportChange={onViewportChange}
                    />
                </WebviewErrorBoundary>
                {showFind && controller && (
                    <FindNode
                        executionPlanView={controller}
                        setExecutionPlanView={() => undefined}
                        findNodeOptions={controller.getUniqueElementProperties()}
                        setFindNodeClicked={(open: boolean) => {
                            if (!open) {
                                onCloseFind();
                            }
                        }}
                        inputRef={inputRef}
                        useReactFlow={true}
                    />
                )}
            </div>
        </section>
    );
}

function flattenPropertyRows(
    rows: readonly ExecutionPlanComparisonPropertyRow[],
): ExecutionPlanComparisonPropertyRow[] {
    return rows.flatMap((row) => [row, ...flattenPropertyRows(row.children)]);
}

function ComparisonPropertyTable({
    primary,
    secondary,
    orientation,
    onClose,
}: {
    primary: ExecutionPlanNode | undefined;
    secondary: ExecutionPlanNode | undefined;
    orientation: ComparisonOrientation;
    onClose: () => void;
}) {
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<PropertySort>("importance");
    const [equivalentOpen, setEquivalentOpen] = useState(false);
    const [focusedRow, setFocusedRow] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const rows = useMemo(
        () =>
            flattenPropertyRows(
                buildExecutionPlanComparisonPropertyRows(
                    primary?.properties,
                    secondary?.properties,
                ),
            ),
        [primary, secondary],
    );
    const filteredRows = useMemo(() => {
        const needle = filter.trim().toLocaleLowerCase();
        const result = needle
            ? rows.filter(
                  (row) =>
                      row.name.toLocaleLowerCase().includes(needle) ||
                      row.primaryValue.toLocaleLowerCase().includes(needle) ||
                      row.secondaryValue.toLocaleLowerCase().includes(needle),
              )
            : rows;
        if (sort === "alphabetical") {
            return [...result].sort((left, right) => left.name.localeCompare(right.name));
        }
        if (sort === "reverseAlphabetical") {
            return [...result].sort((left, right) => right.name.localeCompare(left.name));
        }
        return result;
    }, [filter, rows, sort]);
    const different = filteredRows.filter((row) => row.comparison !== "equal");
    const equivalent = filteredRows.filter((row) => row.comparison === "equal");
    const primaryTitle =
        orientation === "horizontal"
            ? locConstants.executionPlan.topOperation(primary?.name ?? "")
            : locConstants.executionPlan.leftOperation(primary?.name ?? "");
    const secondaryTitle =
        orientation === "horizontal"
            ? locConstants.executionPlan.bottomOperation(secondary?.name ?? "")
            : locConstants.executionPlan.rightOperation(secondary?.name ?? "");
    const primaryColumn =
        orientation === "horizontal"
            ? locConstants.executionPlan.valueTopPlan
            : locConstants.executionPlan.valueLeftPlan;
    const secondaryColumn =
        orientation === "horizontal"
            ? locConstants.executionPlan.valueBottomPlan
            : locConstants.executionPlan.valueRightPlan;
    const virtualRows = useMemo<
        (
            | { kind: "section"; id: string; label: string }
            | { kind: "property"; id: string; row: ExecutionPlanComparisonPropertyRow }
            | { kind: "equivalent"; id: string }
        )[]
    >(
        () => [
            ...(different.length > 0
                ? [
                      {
                          kind: "section" as const,
                          id: "different",
                          label: locConstants.executionPlan.differentProperties,
                      },
                  ]
                : []),
            ...different.map((row) => ({ kind: "property" as const, id: row.id, row })),
            ...(equivalent.length > 0 ? [{ kind: "equivalent" as const, id: "equivalent" }] : []),
            ...(equivalentOpen
                ? equivalent.map((row) => ({
                      kind: "property" as const,
                      id: `equivalent-${row.id}`,
                      row,
                  }))
                : []),
        ],
        [different, equivalent, equivalentOpen],
    );
    const rowVirtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => 27,
        overscan: 8,
    });

    const focusVirtualRow = (index: number) => {
        const nextIndex = Math.min(Math.max(index, 0), virtualRows.length - 1);
        setFocusedRow(nextIndex);
        rowVirtualizer.scrollToIndex(nextIndex);
        requestAnimationFrame(() => {
            scrollContainerRef.current
                ?.querySelector<HTMLElement>(`[data-virtual-row="${nextIndex}"]`)
                ?.focus();
        });
    };

    return (
        <aside
            className="execution-plan-comparison-properties"
            aria-label={locConstants.executionPlan.comparisonProperties}>
            <div className="execution-plan-comparison-properties-title">
                <strong>{locConstants.executionPlan.comparisonProperties}</strong>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular />}
                    title={locConstants.common.close}
                    aria-label={locConstants.common.close}
                    onClick={onClose}
                />
            </div>
            <div className="execution-plan-comparison-operation-titles">
                <span title={primaryTitle}>{primaryTitle}</span>
                <span title={secondaryTitle}>{secondaryTitle}</span>
            </div>
            <div className="execution-plan-comparison-property-tools">
                <Input
                    size="small"
                    value={filter}
                    placeholder={locConstants.executionPlan.propertyFilter}
                    aria-label={locConstants.executionPlan.propertyFilter}
                    onChange={(_, data) => setFilter(data.value)}
                />
                <Dropdown
                    size="small"
                    value={
                        sort === "importance"
                            ? locConstants.executionPlan.importance
                            : sort === "alphabetical"
                              ? locConstants.executionPlan.alphabetical
                              : locConstants.executionPlan.reverseAlphabetical
                    }
                    selectedOptions={[sort]}
                    onOptionSelect={(_, data) => setSort(data.optionValue as PropertySort)}
                    aria-label={locConstants.executionPlan.importance}>
                    <Option value="importance">{locConstants.executionPlan.importance}</Option>
                    <Option value="alphabetical">{locConstants.executionPlan.alphabetical}</Option>
                    <Option value="reverseAlphabetical">
                        {locConstants.executionPlan.reverseAlphabetical}
                    </Option>
                </Dropdown>
            </div>
            <div
                ref={scrollContainerRef}
                className="execution-plan-comparison-property-table-container"
                role="table"
                aria-rowcount={virtualRows.length + 1}
                aria-label={locConstants.executionPlan.comparisonProperties}>
                <div role="rowgroup" className="execution-plan-comparison-property-header">
                    <div role="row" className="execution-plan-comparison-property-row">
                        <div role="columnheader">{locConstants.executionPlan.name}</div>
                        <div role="columnheader">{primaryColumn}</div>
                        <div role="columnheader">{locConstants.executionPlan.comparison}</div>
                        <div role="columnheader">{secondaryColumn}</div>
                    </div>
                </div>
                <div
                    role="rowgroup"
                    className="execution-plan-comparison-property-virtual-body"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const item = virtualRows[virtualRow.index];
                        if (!item) {
                            return undefined;
                        }
                        if (item.kind === "section") {
                            return (
                                <div
                                    key={item.id}
                                    role="row"
                                    aria-rowindex={virtualRow.index + 2}
                                    className="execution-plan-comparison-property-row execution-plan-comparison-section-row"
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}>
                                    <div role="columnheader">{item.label}</div>
                                </div>
                            );
                        }
                        if (item.kind === "equivalent") {
                            return (
                                <div
                                    key={item.id}
                                    role="row"
                                    aria-rowindex={virtualRow.index + 2}
                                    className="execution-plan-comparison-property-row execution-plan-comparison-equivalent"
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}>
                                    <div role="cell">
                                        <button
                                            type="button"
                                            aria-expanded={equivalentOpen}
                                            onClick={() => setEquivalentOpen((open) => !open)}>
                                            {equivalentOpen ? (
                                                <ChevronDown16Regular aria-hidden />
                                            ) : (
                                                <ChevronRight16Regular aria-hidden />
                                            )}{" "}
                                            {locConstants.executionPlan.equivalentProperties} (
                                            {equivalent.length})
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        const row = item.row;
                        const comparisonLabel =
                            row.comparison === "greater"
                                ? locConstants.executionPlan.greaterThan
                                : row.comparison === "less"
                                  ? locConstants.executionPlan.lessThan
                                  : row.comparison === "different"
                                    ? locConstants.executionPlan.notEqual
                                    : "";
                        return (
                            <div
                                key={item.id}
                                role="row"
                                aria-rowindex={virtualRow.index + 2}
                                data-virtual-row={virtualRow.index}
                                tabIndex={focusedRow === virtualRow.index ? 0 : -1}
                                onFocus={() => setFocusedRow(virtualRow.index)}
                                onKeyDown={(event) => {
                                    if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        focusVirtualRow(virtualRow.index + 1);
                                    } else if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        focusVirtualRow(virtualRow.index - 1);
                                    }
                                }}
                                className="execution-plan-comparison-property-row"
                                style={{
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}>
                                <div
                                    role="rowheader"
                                    title={row.name}
                                    style={{
                                        paddingLeft: `${8 + row.level * 14}px`,
                                    }}>
                                    {row.name}
                                </div>
                                <div role="cell" title={row.primaryValue}>
                                    {row.primaryValue}
                                </div>
                                <div
                                    role="cell"
                                    className={`execution-plan-comparison-diff execution-plan-comparison-diff-${row.comparison}`}
                                    title={comparisonLabel}
                                    aria-label={comparisonLabel}>
                                    {row.comparison === "greater" ? (
                                        <ChevronRight16Regular />
                                    ) : row.comparison === "less" ? (
                                        <ChevronLeft16Regular />
                                    ) : row.comparison === "different" ? (
                                        <Dismiss16Regular />
                                    ) : undefined}
                                </div>
                                <div role="cell" title={row.secondaryValue}>
                                    {row.secondaryValue}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}

export function ExecutionPlanComparison() {
    const context = useContext(ExecutionPlanContext);
    const comparisonState = useExecutionPlanSelector((state) => state.executionPlanComparisonState);
    const isPreviewEnabled = useExecutionPlanSelector(
        (state) => state.executionPlanState.isBetaExecutionPlanEnabled === true,
    );
    const [primaryController, setPrimaryController] = useState<ExecutionPlanGraphController | null>(
        null,
    );
    const [secondaryController, setSecondaryController] =
        useState<ExecutionPlanGraphController | null>(null);
    const [primarySelection, setPrimarySelection] = useState<ExecutionPlanNode>();
    const [secondarySelection, setSecondarySelection] = useState<ExecutionPlanNode>();
    const [orientation, setOrientation] = useState<ComparisonOrientation>("horizontal");
    const [splitRatio, setSplitRatio] = useState(0.5);
    const [propertiesOpen, setPropertiesOpen] = useState(false);
    const [findSide, setFindSide] = useState<ComparisonSide>();
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
    const [sharedViewport, setSharedViewport] = useState<Viewport>();
    const splitRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const comparisonMaps = useMemo(
        () => buildExecutionPlanComparisonMaps(comparisonState?.comparisonResult),
        [comparisonState?.comparisonResult],
    );

    const handleViewportChange = useCallback((viewport: Viewport) => {
        setSharedViewport((current) =>
            current &&
            current.x === viewport.x &&
            current.y === viewport.y &&
            current.zoom === viewport.zoom
                ? current
                : viewport,
        );
    }, []);

    const selectMatchingNode = useCallback(
        (
            selected: ExecutionPlanNode,
            matches: ReadonlyMap<string, readonly string[]>,
            targetController: ExecutionPlanGraphController | null,
            targetSelection: ExecutionPlanNode | undefined,
            setTargetSelection: (node: ExecutionPlanNode) => void,
        ) => {
            const matchingIds = matches.get(selected.id);
            if (!targetController || !matchingIds?.length) {
                return;
            }
            if (targetSelection && matchingIds.includes(targetSelection.id)) {
                return;
            }
            const matchingElement = targetController.getElementById(matchingIds[0]);
            if (matchingElement && "name" in matchingElement) {
                targetController.selectElement(matchingElement, false);
                setTargetSelection(matchingElement);
            }
        },
        [],
    );

    const handlePrimarySelection = useCallback(
        (node: ExecutionPlanNode) => {
            setPrimarySelection(node);
            selectMatchingNode(
                node,
                comparisonMaps.primaryMatches,
                secondaryController,
                secondarySelection,
                setSecondarySelection,
            );
        },
        [
            comparisonMaps.primaryMatches,
            secondaryController,
            secondarySelection,
            selectMatchingNode,
        ],
    );
    const handleSecondarySelection = useCallback(
        (node: ExecutionPlanNode) => {
            setSecondarySelection(node);
            selectMatchingNode(
                node,
                comparisonMaps.secondaryMatches,
                primaryController,
                primarySelection,
                setPrimarySelection,
            );
        },
        [comparisonMaps.secondaryMatches, primaryController, primarySelection, selectMatchingNode],
    );

    const handlePrimaryReady = useCallback((controller: ExecutionPlanGraphController | null) => {
        setPrimaryController(controller);
        setPrimarySelection(controller?.getSelectedElement() as ExecutionPlanNode | undefined);
    }, []);
    const handleSecondaryReady = useCallback((controller: ExecutionPlanGraphController | null) => {
        setSecondaryController(controller);
        setSecondarySelection(controller?.getSelectedElement() as ExecutionPlanNode | undefined);
    }, []);

    if (!context || !comparisonState) {
        return undefined;
    }
    if (!isPreviewEnabled) {
        return (
            <div className="execution-plan-comparison-message" role="alert">
                {locConstants.executionPlan.comparisonPreviewRequired}
            </div>
        );
    }

    const primarySource = comparisonState.primary;
    const secondarySource = comparisonState.secondary;
    const activeController = primaryController ?? secondaryController;
    const orientationLabel =
        orientation === "horizontal"
            ? locConstants.executionPlan.switchToSideBySideComparison
            : locConstants.executionPlan.switchToStackedComparison;
    const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current || !splitRef.current) {
            return;
        }
        const bounds = splitRef.current.getBoundingClientRect();
        const ratio =
            orientation === "horizontal"
                ? (event.clientY - bounds.top) / bounds.height
                : (event.clientX - bounds.left) / bounds.width;
        setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };
    const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const decrease =
            (orientation === "horizontal" && event.key === "ArrowUp") ||
            (orientation === "vertical" && event.key === "ArrowLeft");
        const increase =
            (orientation === "horizontal" && event.key === "ArrowDown") ||
            (orientation === "vertical" && event.key === "ArrowRight");
        if (!decrease && !increase) {
            return;
        }
        event.preventDefault();
        setSplitRatio((current) =>
            Math.min(0.8, Math.max(0.2, current + (decrease ? -0.05 : 0.05))),
        );
    };

    return (
        <main
            className="execution-plan-comparison"
            style={{ color: tokens.colorNeutralForeground1 }}>
            <Toolbar
                className="execution-plan-comparison-toolbar"
                aria-label={locConstants.executionPlan.compareExecutionPlans}>
                <ToolbarButton
                    icon={secondarySource ? <ArrowSyncRegular /> : <DocumentAddRegular />}
                    onClick={() => context.selectComparisonPlan()}
                    title={
                        secondarySource
                            ? locConstants.executionPlan.replaceExecutionPlan
                            : locConstants.executionPlan.addExecutionPlan
                    }
                    aria-label={
                        secondarySource
                            ? locConstants.executionPlan.replaceExecutionPlan
                            : locConstants.executionPlan.addExecutionPlan
                    }
                />
                <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
                <ToolbarButton
                    icon={<ZoomInRegular />}
                    disabled={!activeController}
                    onClick={() => activeController?.zoomIn()}
                    title={locConstants.executionPlan.zoomIn}
                    aria-label={locConstants.executionPlan.zoomIn}
                />
                <ToolbarButton
                    icon={<ZoomOutRegular />}
                    disabled={!activeController}
                    onClick={() => activeController?.zoomOut()}
                    title={locConstants.executionPlan.zoomOut}
                    aria-label={locConstants.executionPlan.zoomOut}
                />
                <ToolbarButton
                    icon={<ZoomFitRegular />}
                    disabled={!activeController}
                    onClick={() => activeController?.zoomToFit()}
                    title={locConstants.executionPlan.zoomToFit}
                    aria-label={locConstants.executionPlan.zoomToFit}
                />
                <ToolbarButton
                    icon={<ZoomOriginalSizeIcon16Regular />}
                    disabled={!activeController}
                    onClick={() => setSharedViewport({ x: 0, y: 0, zoom: 1 })}
                    title={locConstants.executionPlan.resetZoom}
                    aria-label={locConstants.executionPlan.resetZoom}
                />
                <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
                <ToolbarButton
                    icon={
                        orientation === "horizontal" ? (
                            <SplitVerticalRegular />
                        ) : (
                            <SplitHorizontalRegular />
                        )
                    }
                    onClick={() =>
                        setOrientation((current) =>
                            current === "horizontal" ? "vertical" : "horizontal",
                        )
                    }
                    title={orientationLabel}
                    aria-label={orientationLabel}
                />
                <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
                <ToolbarButton
                    icon={
                        propertiesOpen ? (
                            <DocumentBulletListFilled />
                        ) : (
                            <DocumentBulletListRegular />
                        )
                    }
                    disabled={!primaryController}
                    onClick={() => setPropertiesOpen((open) => !open)}
                    title={locConstants.executionPlan.properties}
                    aria-label={locConstants.executionPlan.properties}
                    aria-pressed={propertiesOpen}
                />
                <ToolbarButton
                    icon={<SearchPlanIcon planNumber={1} selected={findSide === "primary"} />}
                    disabled={!primaryController}
                    onClick={() =>
                        setFindSide((side) => (side === "primary" ? undefined : "primary"))
                    }
                    title={locConstants.executionPlan.findPrimaryPlan}
                    aria-label={locConstants.executionPlan.findPrimaryPlan}
                    aria-pressed={findSide === "primary"}
                />
                <ToolbarButton
                    icon={<SearchPlanIcon planNumber={2} selected={findSide === "secondary"} />}
                    disabled={!secondaryController}
                    onClick={() =>
                        setFindSide((side) => (side === "secondary" ? undefined : "secondary"))
                    }
                    title={locConstants.executionPlan.findSecondaryPlan}
                    aria-label={locConstants.executionPlan.findSecondaryPlan}
                    aria-pressed={findSide === "secondary"}
                />
                <ToolbarButton
                    icon={tooltipsEnabled ? <TooltipIcon16Regular /> : <TooltipOffIcon16Regular />}
                    disabled={!activeController}
                    onClick={() => {
                        const enabled = primaryController
                            ? primaryController.toggleTooltip()
                            : (secondaryController?.toggleTooltip() ?? true);
                        if (primaryController && secondaryController) {
                            secondaryController.toggleTooltip();
                        }
                        setTooltipsEnabled(enabled);
                    }}
                    title={locConstants.executionPlan.toggleTooltips}
                    aria-label={locConstants.executionPlan.toggleTooltips}
                    aria-pressed={tooltipsEnabled}
                />
            </Toolbar>
            {comparisonState.loadState === ApiStatus.Error && (
                <div className="execution-plan-comparison-error" role="alert">
                    {comparisonState.errorMessage}
                </div>
            )}
            <div className="execution-plan-comparison-content">
                <div
                    ref={splitRef}
                    className={`execution-plan-comparison-split execution-plan-comparison-split-${orientation}`}
                    onPointerMove={resizeFromPointer}
                    onPointerUp={(event) => {
                        draggingRef.current = false;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }}>
                    <div
                        className="execution-plan-comparison-split-pane"
                        style={{ flexBasis: `${splitRatio * 100}%` }}>
                        <ComparisonPlanPane
                            side="primary"
                            source={primarySource}
                            groupRoots={comparisonMaps.primaryGroupRoots}
                            viewport={sharedViewport}
                            onViewportChange={handleViewportChange}
                            onReady={handlePrimaryReady}
                            onSelectionChange={handlePrimarySelection}
                            showFind={findSide === "primary"}
                            onCloseFind={() => setFindSide(undefined)}
                            onSelectGraph={(primaryGraphIndex) => {
                                setPrimaryController(null);
                                setSharedViewport(undefined);
                                context.setComparisonGraphIndexes(primaryGraphIndex, undefined);
                            }}
                        />
                    </div>
                    <div
                        className="execution-plan-comparison-sash"
                        role="separator"
                        tabIndex={0}
                        aria-orientation={orientation === "horizontal" ? "horizontal" : "vertical"}
                        aria-valuemin={20}
                        aria-valuemax={80}
                        aria-valuenow={Math.round(splitRatio * 100)}
                        onKeyDown={resizeFromKeyboard}
                        onPointerDown={(event) => {
                            draggingRef.current = true;
                            event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
                        }}
                    />
                    <div
                        className="execution-plan-comparison-split-pane"
                        style={{ flexBasis: `${(1 - splitRatio) * 100}%` }}>
                        {secondarySource ? (
                            <ComparisonPlanPane
                                side="secondary"
                                source={secondarySource}
                                groupRoots={comparisonMaps.secondaryGroupRoots}
                                viewport={sharedViewport}
                                onViewportChange={handleViewportChange}
                                onReady={handleSecondaryReady}
                                onSelectionChange={handleSecondarySelection}
                                showFind={findSide === "secondary"}
                                onCloseFind={() => setFindSide(undefined)}
                                onSelectGraph={(secondaryGraphIndex) => {
                                    setSecondaryController(null);
                                    setSharedViewport(undefined);
                                    context.setComparisonGraphIndexes(
                                        undefined,
                                        secondaryGraphIndex,
                                    );
                                }}
                            />
                        ) : (
                            <div className="execution-plan-comparison-placeholder">
                                <AddSquareRegular aria-hidden />
                                <p>{locConstants.executionPlan.choosePlanToCompare}</p>
                                <Button
                                    appearance="primary"
                                    icon={<AddSquareRegular />}
                                    onClick={() => context.selectComparisonPlan()}>
                                    {locConstants.executionPlan.addExecutionPlan}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                {propertiesOpen && (
                    <ComparisonPropertyTable
                        primary={primarySelection}
                        secondary={secondarySelection}
                        orientation={orientation}
                        onClose={() => setPropertiesOpen(false)}
                    />
                )}
            </div>
            {comparisonState.loadState === ApiStatus.Loading && (
                <div className="execution-plan-comparison-loading" aria-live="polite">
                    <Spinner size="small" label={locConstants.executionPlan.comparisonLoading} />
                </div>
            )}
        </main>
    );
}
