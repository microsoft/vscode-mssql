/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import {
    Button,
    Input,
    makeStyles,
    mergeClasses,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import {
    Checkmark16Regular,
    Checkmark20Regular,
    Dismiss16Regular,
    Dismiss20Regular,
} from "@fluentui/react-icons";
import {
    type Dispatch,
    KeyboardEvent as ReactKeyboardEvent,
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useRef,
    useState,
    type SetStateAction,
} from "react";

import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { normalizeExecutionPlanQuery } from "./executionPlanQuery";
import { FindNode } from "./findNodes";
import { HighlightExpensiveOperations } from "./highlightExpensiveOperations";
import { LegacyIconStack } from "./legacyIconMenu";
import { PropertiesPane } from "./properties";
import { ReactFlowIconStack } from "./reactFlowIconMenu";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useExecutionPlanSelector } from "./executionPlanSelector";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";
import { WebviewErrorBoundary } from "../../common/webviewErrorBoundary";
import { SqlText } from "../../common/sqlText";
import {
    VscodeFloatingWidget,
    VscodeFloatingWidgetAction,
} from "../../common/vscodeFloatingWidget";

const ReactFlowExecutionPlan = lazy(async () => {
    const module = await import("./reactFlowExecutionPlan");
    return { default: module.ReactFlowExecutionPlan };
});

const LegacyExecutionPlanRenderer = lazy(async () => {
    const module = await import("./legacyExecutionPlanRenderer");
    return { default: module.LegacyExecutionPlanRenderer };
});

const useStyles = makeStyles({
    panelContainer: {
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        position: "relative",
        overflowY: "hidden",
    },
    planContainer: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        width: "100%",
        minHeight: "300px",
    },
    inputContainer: {
        position: "absolute",
        top: 0,
        right: "35px",
        padding: "10px",
        border: "1px solid #ccc",
        zIndex: "1",
        boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)",
        display: "flex",
        alignItems: "center",
        gap: "2px",
        opacity: 1,
    },
    previewInputContainer: {
        position: "absolute",
        top: "4px",
        right: "39px",
        zIndex: 5,
        maxWidth: "calc(100% - 51px)",
    },
    previewZoomInput: {
        width: "72px",
        minWidth: "72px",
        height: "26px",
        boxSizing: "border-box",
        fontSize: "12px",
    },
    previewInputSuffix: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "12px",
    },
    queryCostContainer: {
        opacity: 1,
        boxSizing: "border-box",
        flexShrink: 0,
        padding: "6px 8px 7px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    legacyQueryCostContainer: {
        opacity: 1,
        padding: "5px",
    },
    queryCostSummary: {
        color: tokens.colorNeutralForeground1,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase200,
        paddingBottom: "4px",
    },
    queryText: {
        fontSize: "12px",
        lineHeight: "17px",
        maxHeight: "17px",
        paddingTop: "4px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    queryPlanParent: {
        opacity: 1,
        height: "100%",
        width: "100%",
        overflowX: "auto",
    },
    legacyGraphContainer: {
        height: "100%",
        width: "100%",
    },
    resizable: {
        position: "absolute",
        top: 0,
        right: "35px",
        opacity: 1,
        boxSizing: "border-box",
        minWidth: "295px",
        height: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
    resizer: {
        position: "absolute",
        left: 0,
        height: "100%",
        width: "15px",
        cursor: "ew-resize",
        backgroundColor: "transparent",
    },
    previewResizer: {
        left: "-5px",
        zIndex: 4,
        width: "11px",
        outline: "none",
        touchAction: "none",
        "&::after": {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "5px",
            width: "1px",
            backgroundColor: "transparent",
            content: '""',
        },
        "&:hover::after": {
            left: "4px",
            width: "2px",
            backgroundColor: "var(--vscode-sash-hoverBorder, var(--vscode-focusBorder))",
        },
        "&:focus-visible::after": {
            left: "4px",
            width: "2px",
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    spacer: {
        padding: "1px",
    },
});

export interface ExecutionPlanGraphViewState {
    zoomPercent: number;
    scrollTop: number;
    scrollLeft: number;
    selectedElementId?: string;
    propertiesPaneOpen: boolean;
    propertiesPaneWidth: number;
}

export const DEFAULT_EXECUTION_PLAN_GRAPH_VIEW_STATE: ExecutionPlanGraphViewState = {
    zoomPercent: 100,
    scrollTop: 0,
    scrollLeft: 0,
    propertiesPaneOpen: false,
    propertiesPaneWidth: 400,
};

export function normalizeExecutionPlanGraphViewState(
    viewState?: Partial<ExecutionPlanGraphViewState>,
): ExecutionPlanGraphViewState {
    const zoomPercent = Number.isFinite(viewState?.zoomPercent)
        ? Math.min(200, Math.max(1, viewState!.zoomPercent!))
        : DEFAULT_EXECUTION_PLAN_GRAPH_VIEW_STATE.zoomPercent;
    const propertiesPaneWidth = Number.isFinite(viewState?.propertiesPaneWidth)
        ? Math.max(295, viewState!.propertiesPaneWidth!)
        : DEFAULT_EXECUTION_PLAN_GRAPH_VIEW_STATE.propertiesPaneWidth;

    return {
        zoomPercent,
        scrollTop: Number.isFinite(viewState?.scrollTop) ? Math.max(0, viewState!.scrollTop!) : 0,
        scrollLeft: Number.isFinite(viewState?.scrollLeft)
            ? Math.max(0, viewState!.scrollLeft!)
            : 0,
        selectedElementId:
            typeof viewState?.selectedElementId === "string"
                ? viewState.selectedElementId
                : undefined,
        propertiesPaneOpen: viewState?.propertiesPaneOpen === true,
        propertiesPaneWidth,
    };
}

interface ExecutionPlanGraphProps {
    graphIndex: number;
    active?: boolean;
    initialViewState?: ExecutionPlanGraphViewState;
    onViewStateChange?: (viewState: ExecutionPlanGraphViewState) => void;
}

interface ExecutionPlanGraphViewProps extends ExecutionPlanGraphProps {
    executionPlanState: ExecutionPlanState;
}

export const ExecutionPlanGraph: React.FC<ExecutionPlanGraphProps> = ({
    graphIndex,
    active,
    initialViewState,
    onViewStateChange,
}) => {
    const executionPlanState = useExecutionPlanSelector<ExecutionPlanState>(
        (s) => s.executionPlanState,
    );
    if (!executionPlanState) {
        return null;
    }
    return (
        <ExecutionPlanGraphView
            graphIndex={graphIndex}
            active={active}
            executionPlanState={executionPlanState}
            initialViewState={initialViewState}
            onViewStateChange={onViewStateChange}
        />
    );
};

export const ExecutionPlanGraphView: React.FC<ExecutionPlanGraphViewProps> = ({
    graphIndex,
    active = true,
    executionPlanState,
    initialViewState,
    onViewStateChange,
}) => {
    const restoredViewState = useRef<ExecutionPlanGraphViewState>(
        normalizeExecutionPlanGraphViewState(initialViewState),
    );
    const hasRestoredViewState = useRef(initialViewState !== undefined);
    const currentViewState = useRef<ExecutionPlanGraphViewState>(restoredViewState.current);
    const onViewStateChangeRef = useRef(onViewStateChange);
    onViewStateChangeRef.current = onViewStateChange;

    const updateViewState = useCallback((patch: Partial<ExecutionPlanGraphViewState>) => {
        currentViewState.current = { ...currentViewState.current, ...patch };
        onViewStateChangeRef.current?.(currentViewState.current);
    }, []);

    const classes = useStyles();
    const { themeKind, extensionRpc } = useVscodeWebview();
    const [query, setQuery] = useState("");
    const [xml, setXml] = useState("");
    const [cost, setCost] = useState(0);
    const [executionPlanView, setExecutionPlanView] = useState<ExecutionPlanGraphController | null>(
        null,
    );
    const [zoomNumber, setZoomNumber] = useState(restoredViewState.current.zoomPercent);
    const [customZoomClicked, setCustomZoomClicked] = useState(false);
    const [findNodeClicked, setFindNodeClicked] = useState(false);
    const [findNodeOptions, setFindNodeOptions] = useState<string[]>([]);
    const [highlightOpsClicked, setHighlightOpsClicked] = useState(false);
    const [propertiesClicked, setPropertiesClicked] = useState(
        restoredViewState.current.propertiesPaneOpen,
    );
    const [propertiesWidth, setPropertiesWidth] = useState(
        restoredViewState.current.propertiesPaneWidth,
    );
    const [containerHeight, setContainerHeight] = useState("100%");
    const resizableRef = useRef<HTMLDivElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const propertiesWidthRef = useRef(restoredViewState.current.propertiesPaneWidth);
    const inputRef = useRef<any | null>(null);
    const useReactFlow = executionPlanState?.isBetaExecutionPlanEnabled === true;
    const graph = executionPlanState?.executionPlanGraphs?.[graphIndex];
    const [reactFlowFailed, setReactFlowFailed] = useState(false);
    const isReactFlowActive = useReactFlow && !reactFlowFailed;
    const setPropertiesOpen: Dispatch<SetStateAction<boolean>> = useCallback(
        (value) => {
            setPropertiesClicked((currentValue) => {
                const nextValue = typeof value === "function" ? value(currentValue) : value;
                updateViewState({ propertiesPaneOpen: nextValue });
                return nextValue;
            });
        },
        [updateViewState],
    );

    useEffect(() => {
        if (!executionPlanState || !graph) {
            return;
        }
        setContainerHeight(
            executionPlanState.executionPlanGraphs!.length > 1 &&
                graphIndex !== executionPlanState.executionPlanGraphs!.length - 1
                ? "500px"
                : "100%",
        );

        setQuery(normalizeExecutionPlanQuery(graph.query));
        setXml(graph.graphFile.graphFileContent);
    }, [executionPlanState, graph, graphIndex]);

    useEffect(() => {
        setReactFlowFailed(false);
    }, [graph, useReactFlow]);

    useEffect(() => {
        setZoomNumber(restoredViewState.current.zoomPercent);
        setCustomZoomClicked(false);
        setFindNodeClicked(false);
        setHighlightOpsClicked(false);
        setPropertiesClicked(restoredViewState.current.propertiesPaneOpen);
    }, [isReactFlowActive]);

    const handleRendererReady = useCallback((controller: ExecutionPlanGraphController | null) => {
        setExecutionPlanView(controller);
        if (controller) {
            const restoredState = restoredViewState.current;
            if (hasRestoredViewState.current) {
                controller.setZoomLevel(restoredState.zoomPercent);
                const selectedElement = restoredState.selectedElementId
                    ? controller.getElementById(restoredState.selectedElementId)
                    : undefined;
                if (selectedElement) {
                    controller.selectElement(selectedElement);
                }
            }
            const loadedZoom = controller.getZoomLevel();
            setFindNodeOptions(controller.getUniqueElementProperties());
            setCost(controller.getTotalRelativeCost());
            setZoomNumber(loadedZoom);
            currentViewState.current = {
                ...currentViewState.current,
                zoomPercent: loadedZoom,
                selectedElementId: controller.getSelectedElement()?.id,
            };
        } else {
            setFindNodeOptions([]);
            setCost(0);
            setZoomNumber(restoredViewState.current.zoomPercent);
        }
    }, []);

    useEffect(() => {
        const graphContainer = graphContainerRef.current;
        if (!graphContainer) {
            return;
        }

        let scrollFrame: number | undefined;
        const captureViewState = () => {
            if (scrollFrame !== undefined) {
                return;
            }
            scrollFrame = window.requestAnimationFrame(() => {
                scrollFrame = undefined;
                updateViewState({
                    scrollTop: graphContainer.scrollTop,
                    scrollLeft: graphContainer.scrollLeft,
                    selectedElementId: executionPlanView?.getSelectedElement()?.id,
                });
            });
        };
        graphContainer.addEventListener("scroll", captureViewState, { passive: true });
        graphContainer.addEventListener("click", captureViewState);

        const restoreFrame = window.requestAnimationFrame(() => {
            graphContainer.scrollTop = restoredViewState.current.scrollTop;
            graphContainer.scrollLeft = restoredViewState.current.scrollLeft;
        });

        return () => {
            updateViewState({
                scrollTop: graphContainer.scrollTop,
                scrollLeft: graphContainer.scrollLeft,
                selectedElementId: executionPlanView?.getSelectedElement()?.id,
            });
            window.cancelAnimationFrame(restoreFrame);
            if (scrollFrame !== undefined) {
                window.cancelAnimationFrame(scrollFrame);
            }
            graphContainer.removeEventListener("scroll", captureViewState);
            graphContainer.removeEventListener("click", captureViewState);
        };
    }, [executionPlanView, graph?.graphFile.graphFileContent, updateViewState]);

    useEffect(() => {
        if (inputRef && inputRef.current) {
            inputRef.current.focus();
        }
    }, [customZoomClicked, findNodeClicked, highlightOpsClicked, propertiesClicked]);

    const handleCustomZoomInput = async () => {
        if (executionPlanView) {
            executionPlanView.setZoomLevel(zoomNumber);
            setExecutionPlanView(executionPlanView);
            const appliedZoom = executionPlanView.getZoomLevel();
            setZoomNumber(appliedZoom);
            updateViewState({ zoomPercent: appliedZoom });
        }
        setCustomZoomClicked(false);
    };

    const getQueryCostPercentage = () => {
        const percentage =
            executionPlanState?.totalCost && executionPlanState.totalCost > 0
                ? (cost / executionPlanState.totalCost) * 100
                : 0;
        return percentage.toFixed(2);
    };

    const getQueryCostString = () => {
        return locConstants.executionPlan.queryCostRelativeToScript(
            graphIndex + 1,
            getQueryCostPercentage(),
        );
    };

    // this is for resizing the properties panel
    const onMouseDown = (e: any) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = resizableRef!.current!.offsetWidth;

        const onMouseMove = (e: any) => {
            const newWidth = startWidth - (e.pageX - startX);
            if (newWidth >= 295) {
                propertiesWidthRef.current = newWidth;
                setPropertiesWidth(newWidth);
            }
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            updateViewState({ propertiesPaneWidth: propertiesWidthRef.current });
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const onResizerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const resizeStep = event.shiftKey ? 50 : 10;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        event.preventDefault();
        setPropertiesWidth((currentWidth) => {
            const nextWidth =
                event.key === "ArrowLeft"
                    ? currentWidth + resizeStep
                    : Math.max(295, currentWidth - resizeStep);
            propertiesWidthRef.current = nextWidth;
            updateViewState({ propertiesPaneWidth: nextWidth });
            return nextWidth;
        });
    };

    return (
        <div
            id="panelContainer"
            className={classes.panelContainer}
            style={{
                height: containerHeight,
                fontFamily: tokens.fontFamilyBase,
            }}>
            <div
                id="planContainer"
                className={classes.planContainer}
                style={{
                    height: containerHeight,
                }}>
                <div
                    id="queryCostContainer"
                    className={
                        isReactFlowActive
                            ? classes.queryCostContainer
                            : classes.legacyQueryCostContainer
                    }
                    style={{
                        background: tokens.colorNeutralBackground2,
                        // 35px is the width of the side toolbar with some extra room for padding
                        width: propertiesClicked
                            ? `calc(100% - ${propertiesWidth}px - 35px)`
                            : "calc(100% - 35px)",
                        maxWidth: propertiesClicked
                            ? `calc(100% - ${propertiesWidth}px - 35px)`
                            : "calc(100% - 35px)",
                    }}
                    aria-live="polite"
                    aria-label={`${getQueryCostString()}, ${query}`}>
                    {isReactFlowActive ? (
                        <>
                            <div className={classes.queryCostSummary}>{getQueryCostString()}</div>
                            <SqlText
                                className={classes.queryText}
                                text={query}
                                singleLine
                                showLineBreaks
                                title={query}
                            />
                        </>
                    ) : (
                        <>
                            {getQueryCostString()}
                            <br />
                            {query}
                        </>
                    )}
                </div>
                <div
                    ref={graphContainerRef}
                    id={`queryPlanParent${graphIndex + 1}`}
                    className={classes.queryPlanParent}
                    style={{
                        // 35px is the width of the side toolbar with some extra room for padding
                        width: propertiesClicked
                            ? `calc(100% - ${propertiesWidth}px - 35px)`
                            : "calc(100% - 35px)",
                    }}>
                    {!isReactFlowActive && graph && (
                        <Suspense
                            fallback={
                                <Spinner label={locConstants.executionPlan.loadingExecutionPlan} />
                            }>
                            <LegacyExecutionPlanRenderer
                                root={graph.root}
                                themeKind={themeKind}
                                className={classes.legacyGraphContainer}
                                onReady={handleRendererReady}
                            />
                        </Suspense>
                    )}
                    {isReactFlowActive && graph && (
                        <WebviewErrorBoundary
                            fallback={
                                <div
                                    role="alert"
                                    style={{
                                        padding: "16px",
                                        color: tokens.colorPaletteRedForeground1,
                                    }}>
                                    {locConstants.executionPlan.reactFlowRendererError}
                                </div>
                            }
                            onError={(error, errorInfo) => {
                                setReactFlowFailed(true);
                                setExecutionPlanView(null);
                                extensionRpc.log.error(
                                    "React Flow execution plan renderer failed",
                                    error,
                                    errorInfo.componentStack,
                                );
                            }}>
                            <Suspense
                                fallback={
                                    <Spinner
                                        label={locConstants.executionPlan.loadingExecutionPlan}
                                    />
                                }>
                                <ReactFlowExecutionPlan
                                    root={graph.root}
                                    themeKind={themeKind}
                                    planNumber={graphIndex + 1}
                                    onReady={handleRendererReady}
                                />
                            </Suspense>
                        </WebviewErrorBoundary>
                    )}
                </div>
                {customZoomClicked &&
                    (isReactFlowActive ? (
                        <VscodeFloatingWidget
                            id="customZoomInputContainer"
                            className={classes.previewInputContainer}
                            role="group"
                            aria-label={locConstants.executionPlan.customZoom}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setCustomZoomClicked(false);
                                }
                            }}>
                            <Input
                                ref={inputRef}
                                id="customZoomInputBox"
                                type="text"
                                size="small"
                                className={classes.previewZoomInput}
                                defaultValue={Math.floor(zoomNumber).toString()}
                                contentAfter={<span className={classes.previewInputSuffix}>%</span>}
                                input={{
                                    inputMode: "decimal",
                                    style: {
                                        textOverflow: "ellipsis",
                                    },
                                }}
                                title={locConstants.executionPlan.customZoom}
                                aria-label={locConstants.executionPlan.customZoom}
                                onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isFinite(value)) {
                                        setZoomNumber(Math.min(200, Math.max(1, value)));
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        void handleCustomZoomInput();
                                    }
                                }}
                            />
                            <VscodeFloatingWidgetAction
                                onClick={handleCustomZoomInput}
                                title={locConstants.common.apply}
                                aria-label={locConstants.common.apply}
                                icon={<Checkmark16Regular />}
                            />
                            <VscodeFloatingWidgetAction
                                icon={<Dismiss16Regular />}
                                title={locConstants.common.close}
                                aria-label={locConstants.common.close}
                                onClick={() => setCustomZoomClicked(false)}
                            />
                        </VscodeFloatingWidget>
                    ) : (
                        <div
                            id="customZoomInputContainer"
                            className={classes.inputContainer}
                            style={{
                                background: tokens.colorNeutralBackground1,
                            }}
                            tabIndex={0}>
                            <Input
                                ref={inputRef}
                                id="customZoomInputBox"
                                type="number"
                                size="small"
                                min={1}
                                tabIndex={0}
                                title={locConstants.executionPlan.customZoom}
                                aria-label={locConstants.executionPlan.customZoom}
                                defaultValue={Math.floor(zoomNumber).toString()}
                                input={{
                                    style: {
                                        width: "85px",
                                        textOverflow: "ellipsis",
                                    },
                                }}
                                onChange={(e) => setZoomNumber(Number(e.target.value))}
                                style={{
                                    width: "100px",
                                    height: "25px",
                                    fontSize: "12px",
                                }}
                            />
                            <div className={classes.spacer}></div>
                            <Button
                                onClick={handleCustomZoomInput}
                                size="small"
                                appearance="subtle"
                                title={locConstants.common.apply}
                                aria-label={locConstants.common.apply}
                                icon={<Checkmark20Regular />}
                            />
                            <Button
                                icon={<Dismiss20Regular />}
                                size="small"
                                appearance="subtle"
                                title={locConstants.common.close}
                                aria-label={locConstants.common.close}
                                onClick={() => setCustomZoomClicked(false)}
                            />
                        </div>
                    ))}
                {findNodeClicked && executionPlanView && (
                    <div tabIndex={isReactFlowActive ? undefined : 0}>
                        <FindNode
                            // guaranteed to be non-null, because the plan will only
                            // show if it's non-null
                            executionPlanView={executionPlanView!}
                            setExecutionPlanView={setExecutionPlanView}
                            findNodeOptions={findNodeOptions}
                            setFindNodeClicked={setFindNodeClicked}
                            inputRef={inputRef}
                            useReactFlow={isReactFlowActive}
                        />
                    </div>
                )}
                {highlightOpsClicked && executionPlanView && (
                    <div tabIndex={isReactFlowActive ? undefined : 0}>
                        <HighlightExpensiveOperations
                            // guaranteed to be non-null
                            executionPlanView={executionPlanView!}
                            setExecutionPlanView={setExecutionPlanView}
                            setHighlightOpsClicked={setHighlightOpsClicked}
                            inputRef={inputRef}
                            useReactFlow={isReactFlowActive}
                        />
                    </div>
                )}
                {propertiesClicked && executionPlanView && (
                    <div
                        className={classes.resizable}
                        style={{ width: `${propertiesWidth}px` }}
                        ref={resizableRef}>
                        <div
                            className={
                                isReactFlowActive
                                    ? mergeClasses(classes.resizer, classes.previewResizer)
                                    : classes.resizer
                            }
                            role={isReactFlowActive ? "separator" : undefined}
                            aria-orientation={isReactFlowActive ? "vertical" : undefined}
                            aria-label={
                                isReactFlowActive
                                    ? `${locConstants.queryResult.resize} ${locConstants.executionPlan.properties}`
                                    : undefined
                            }
                            aria-valuemin={isReactFlowActive ? 295 : undefined}
                            aria-valuenow={
                                isReactFlowActive ? Math.round(propertiesWidth) : undefined
                            }
                            tabIndex={isReactFlowActive ? 0 : undefined}
                            onMouseDown={onMouseDown}
                            onKeyDown={isReactFlowActive ? onResizerKeyDown : undefined}
                        />
                        <div style={{ height: "100%" }} tabIndex={0}>
                            <PropertiesPane
                                // guaranteed to be non-null
                                executionPlanView={executionPlanView!}
                                setPropertiesClicked={setPropertiesOpen}
                                inputRef={inputRef}
                                active={active}
                                useReactFlow={isReactFlowActive}
                            />
                        </div>
                    </div>
                )}
            </div>
            {executionPlanView && (
                <>
                    {isReactFlowActive ? (
                        <ReactFlowIconStack
                            executionPlanView={executionPlanView}
                            setExecutionPlanView={setExecutionPlanView}
                            setZoomNumber={setZoomNumber}
                            onZoomChange={(zoomPercent) => updateViewState({ zoomPercent })}
                            customZoomClicked={customZoomClicked}
                            setCustomZoomClicked={setCustomZoomClicked}
                            findNodeClicked={findNodeClicked}
                            setFindNodeClicked={setFindNodeClicked}
                            highlightOpsClicked={highlightOpsClicked}
                            setHighlightOpsClicked={setHighlightOpsClicked}
                            propertiesClicked={propertiesClicked}
                            setPropertiesClicked={setPropertiesOpen}
                            query={query}
                            xml={xml}
                        />
                    ) : (
                        <LegacyIconStack
                            executionPlanView={executionPlanView}
                            setExecutionPlanView={setExecutionPlanView}
                            setZoomNumber={setZoomNumber}
                            onZoomChange={(zoomPercent) => updateViewState({ zoomPercent })}
                            setCustomZoomClicked={setCustomZoomClicked}
                            setFindNodeClicked={setFindNodeClicked}
                            setHighlightOpsClicked={setHighlightOpsClicked}
                            setPropertiesClicked={setPropertiesOpen}
                            query={query}
                            xml={xml}
                        />
                    )}
                </>
            )}
        </div>
    );
};
