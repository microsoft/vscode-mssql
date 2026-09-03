/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Input,
    makeStyles,
    mergeClasses,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { Checkmark16Regular, Dismiss16Regular, Lightbulb16Filled } from "@fluentui/react-icons";
import {
    KeyboardEvent as ReactKeyboardEvent,
    lazy,
    Suspense,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import {
    normalizeExecutionPlanQuery,
    ParsedRecommendation,
    parseRecommendationDisplayString,
} from "./executionPlanQuery";
import { FindNode } from "./findNodes";
import { HighlightExpensiveOperations } from "./highlightExpensiveOperations";
import { PropertiesPane } from "./properties";
import { ReactFlowIconStack } from "./reactFlowIconMenu";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
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
    recommendations: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        rowGap: "3px",
        paddingTop: "6px",
        // caps the header at roughly three recommendations before scrolling, so a plan
        // with many missing indexes doesn't squeeze the graph out of view
        maxHeight: "78px",
        overflowY: "auto",
    },
    recommendationButton: {
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
        columnGap: "6px",
        width: "100%",
        minWidth: 0,
        height: "auto",
        minHeight: "22px",
        padding: "2px 6px",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorTransparentStroke}`,
        backgroundColor: tokens.colorNeutralBackground3,
        textAlign: "left",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground3Hover,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
        ":hover:active": {
            backgroundColor: tokens.colorNeutralBackground3Pressed,
        },
    },
    recommendationIcon: {
        flexShrink: 0,
        color: tokens.colorPaletteYellowForeground2,
    },
    recommendationLabel: {
        flexShrink: 0,
        fontSize: "12px",
        lineHeight: "17px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    recommendationImpact: {
        flexShrink: 0,
    },
    recommendationScript: {
        flexGrow: 1,
        minWidth: 0,
        fontSize: "12px",
        lineHeight: "17px",
    },
    queryPlanParent: {
        opacity: 1,
        height: "100%",
        width: "100%",
        overflowX: "auto",
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
});

interface ExecutionPlanGraphProps {
    graphIndex: number;
}

/** A recommendation split into the parts the header renders separately. */
interface RecommendationView extends ParsedRecommendation {
    /** Untouched server string, used as the button's accessible name and tooltip. */
    accessibleName: string;
    queryWithDescription: string;
}

export const ExecutionPlanGraph: React.FC<ExecutionPlanGraphProps> = ({ graphIndex }) => {
    const classes = useStyles();
    const { themeKind, extensionRpc } = useVscodeWebview();
    const context = useContext(ExecutionPlanContext);
    const executionPlanState = useExecutionPlanSelector<ExecutionPlanState>(
        (s) => s.executionPlanState,
    );
    const [query, setQuery] = useState("");
    const [xml, setXml] = useState("");
    const [recommendations, setRecommendations] = useState<RecommendationView[]>([]);
    const [cost, setCost] = useState(0);
    const [executionPlanView, setExecutionPlanView] = useState<ExecutionPlanGraphController | null>(
        null,
    );
    const [zoomNumber, setZoomNumber] = useState(100);
    const [customZoomClicked, setCustomZoomClicked] = useState(false);
    const [findNodeClicked, setFindNodeClicked] = useState(false);
    const [findNodeOptions, setFindNodeOptions] = useState<string[]>([]);
    const [highlightOpsClicked, setHighlightOpsClicked] = useState(false);
    const [propertiesClicked, setPropertiesClicked] = useState(false);
    const [propertiesWidth, setPropertiesWidth] = useState(400);
    const [containerHeight, setContainerHeight] = useState("100%");
    const resizableRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<any | null>(null);
    const graph = executionPlanState?.executionPlanGraphs?.[graphIndex];

    const resetTransientUiState = useCallback(() => {
        setZoomNumber(100);
        setCustomZoomClicked(false);
        setFindNodeClicked(false);
        setHighlightOpsClicked(false);
        setPropertiesClicked(false);
    }, []);

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
        setRecommendations(
            (graph.recommendations ?? []).map((recommendation) => ({
                ...parseRecommendationDisplayString(recommendation.displayString),
                accessibleName: recommendation.displayString,
                queryWithDescription: recommendation.queryWithDescription,
            })),
        );
    }, [executionPlanState, graph, graphIndex]);

    useEffect(() => {
        resetTransientUiState();
    }, [graph, resetTransientUiState]);

    const handleRendererReady = useCallback(
        (controller: ExecutionPlanGraphController | null) => {
            setExecutionPlanView(controller);
            if (controller) {
                setFindNodeOptions(controller.getUniqueElementProperties());
                setCost(controller.getTotalRelativeCost());
                setZoomNumber(controller.getZoomLevel());
            } else {
                setFindNodeOptions([]);
                setCost(0);
                resetTransientUiState();
            }
        },
        [resetTransientUiState],
    );

    useEffect(() => {
        if (inputRef && inputRef.current) {
            inputRef.current.focus();
        }
    }, [customZoomClicked, findNodeClicked, highlightOpsClicked, propertiesClicked]);

    const handleCustomZoomInput = async () => {
        if (executionPlanView) {
            executionPlanView.setZoomLevel(zoomNumber);
            setExecutionPlanView(executionPlanView);
            setZoomNumber(executionPlanView.getZoomLevel());
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

    const handleRecommendationClick = (recommendation: RecommendationView) => {
        // opens the CREATE INDEX script wrapped in its explanatory comment block, without
        // running it, so the user can review and edit before executing
        context?.showQuery(recommendation.queryWithDescription);
    };

    // this is for resizing the properties panel
    const onMouseDown = (e: any) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = resizableRef!.current!.offsetWidth;

        const onMouseMove = (e: any) => {
            const newWidth = startWidth - (e.pageX - startX);
            if (newWidth >= 275) {
                setPropertiesWidth(newWidth);
            }
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const onResizerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const resizeStep = event.shiftKey ? 50 : 10;
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            setPropertiesWidth((currentWidth) => currentWidth + resizeStep);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setPropertiesWidth((currentWidth) => Math.max(295, currentWidth - resizeStep));
        }
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
                    className={classes.queryCostContainer}
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
                    aria-label={
                        recommendations.length > 0
                            ? `${getQueryCostString()}, ${query}, ${locConstants.executionPlan.missingIndexRecommendations}`
                            : `${getQueryCostString()}, ${query}`
                    }>
                    <div className={classes.queryCostSummary}>{getQueryCostString()}</div>
                    <SqlText
                        className={classes.queryText}
                        text={query}
                        singleLine
                        showLineBreaks
                        title={query}
                    />
                    {recommendations.length > 0 && (
                        <div
                            className={classes.recommendations}
                            role="group"
                            aria-label={locConstants.executionPlan.missingIndexRecommendations}>
                            {recommendations.map((recommendation, index) => (
                                <Button
                                    key={index}
                                    appearance="subtle"
                                    className={classes.recommendationButton}
                                    icon={
                                        <Lightbulb16Filled className={classes.recommendationIcon} />
                                    }
                                    aria-label={recommendation.accessibleName}
                                    title={`${recommendation.accessibleName}\n\n${locConstants.executionPlan.openIndexRecommendationScript}`}
                                    onClick={() => handleRecommendationClick(recommendation)}>
                                    <span className={classes.recommendationLabel}>
                                        {locConstants.executionPlan.missingIndex}
                                    </span>
                                    {recommendation.impact !== undefined && (
                                        <Badge
                                            appearance="tint"
                                            color="success"
                                            size="small"
                                            className={classes.recommendationImpact}>
                                            {locConstants.executionPlan.missingIndexImpact(
                                                recommendation.impact.toFixed(1),
                                            )}
                                        </Badge>
                                    )}
                                    <SqlText
                                        className={classes.recommendationScript}
                                        text={recommendation.script}
                                        singleLine
                                    />
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
                <div
                    id={`queryPlanParent${graphIndex + 1}`}
                    className={classes.queryPlanParent}
                    style={{
                        // 35px is the width of the side toolbar with some extra room for padding
                        width: propertiesClicked
                            ? `calc(100% - ${propertiesWidth}px - 35px)`
                            : "calc(100% - 35px)",
                    }}>
                    {graph && (
                        <WebviewErrorBoundary
                            fallback={
                                <div
                                    role="alert"
                                    style={{
                                        padding: "16px",
                                        color: tokens.colorPaletteRedForeground1,
                                    }}>
                                    {locConstants.executionPlan.executionPlanRendererError}
                                </div>
                            }
                            onError={(error, errorInfo) => {
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
                {customZoomClicked && (
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
                )}
                {findNodeClicked && executionPlanView && (
                    <FindNode
                        // guaranteed to be non-null, because the plan will only
                        // show if it's non-null
                        executionPlanView={executionPlanView!}
                        setExecutionPlanView={setExecutionPlanView}
                        findNodeOptions={findNodeOptions}
                        setFindNodeClicked={setFindNodeClicked}
                        inputRef={inputRef}
                    />
                )}
                {highlightOpsClicked && executionPlanView && (
                    <HighlightExpensiveOperations
                        // guaranteed to be non-null
                        executionPlanView={executionPlanView!}
                        setExecutionPlanView={setExecutionPlanView}
                        setHighlightOpsClicked={setHighlightOpsClicked}
                        inputRef={inputRef}
                    />
                )}
                {propertiesClicked && executionPlanView && (
                    <div
                        className={classes.resizable}
                        style={{ width: `${propertiesWidth}px` }}
                        ref={resizableRef}>
                        <div
                            className={mergeClasses(classes.resizer, classes.previewResizer)}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`${locConstants.queryResult.resize} ${locConstants.executionPlan.properties}`}
                            aria-valuemin={295}
                            aria-valuenow={Math.round(propertiesWidth)}
                            tabIndex={0}
                            onMouseDown={onMouseDown}
                            onKeyDown={onResizerKeyDown}
                        />
                        <div style={{ height: "100%" }} tabIndex={0}>
                            <PropertiesPane
                                // guaranteed to be non-null
                                executionPlanView={executionPlanView!}
                                setPropertiesClicked={setPropertiesClicked}
                                inputRef={inputRef}
                            />
                        </div>
                    </div>
                )}
            </div>
            {executionPlanView && (
                <ReactFlowIconStack
                    executionPlanView={executionPlanView}
                    setExecutionPlanView={setExecutionPlanView}
                    setZoomNumber={setZoomNumber}
                    customZoomClicked={customZoomClicked}
                    setCustomZoomClicked={setCustomZoomClicked}
                    findNodeClicked={findNodeClicked}
                    setFindNodeClicked={setFindNodeClicked}
                    highlightOpsClicked={highlightOpsClicked}
                    setHighlightOpsClicked={setHighlightOpsClicked}
                    propertiesClicked={propertiesClicked}
                    setPropertiesClicked={setPropertiesClicked}
                    query={query}
                    xml={xml}
                />
            )}
        </div>
    );
};
