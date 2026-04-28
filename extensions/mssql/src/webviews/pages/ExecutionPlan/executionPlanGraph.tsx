/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import { Button, Input, makeStyles, tokens } from "@fluentui/react-components";
import { Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { ExecutionPlanView } from "./executionPlanView";
import { ExecutionPlanFlow } from "./executionPlanFlow";
import { FindNode } from "./findNodes";
import { HighlightExpensiveOperations } from "./highlightExpensiveOperations";
import { IconStack } from "./iconMenu";
import { PropertiesPane } from "./properties";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useExecutionPlanSelector } from "./executionPlanSelector";
import { AzDataGraphCell, ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";

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
        top: "8px",
        right: "35px",
        padding: "8px 10px",
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        zIndex: "1",
        boxShadow: tokens.shadow8,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        opacity: 1,
        color: tokens.colorNeutralForeground1,
        fontSize: tokens.fontSizeBase200,
    },
    queryCostContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        opacity: 1,
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        boxSizing: "border-box",
        color: tokens.colorNeutralForeground1,
        overflow: "hidden",
    },
    queryCostText: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase300,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    queryText: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
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
    spacer: {
        padding: "1px",
    },
});

interface ExecutionPlanGraphProps {
    graphIndex: number;
}

export const ExecutionPlanGraph: React.FC<ExecutionPlanGraphProps> = ({ graphIndex }) => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview();
    const executionPlanState = useExecutionPlanSelector<ExecutionPlanState>(
        (s) => s.executionPlanState,
    );
    const [isExecutionPlanLoaded, setIsExecutionPlanLoaded] = useState(false);
    const [query, setQuery] = useState("");
    const [xml, setXml] = useState("");
    const [cost, setCost] = useState(0);
    const [executionPlanView, setExecutionPlanView] = useState<ExecutionPlanView | null>(null);
    const [renderedExecutionPlanGraph, setRenderedExecutionPlanGraph] =
        useState<AzDataGraphCell | null>(null);
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

    useEffect(() => {
        if (!executionPlanState || isExecutionPlanLoaded) return;

        setContainerHeight(
            executionPlanState!.executionPlanGraphs!.length > 1 &&
                graphIndex !== executionPlanState!.executionPlanGraphs!.length - 1
                ? "500px"
                : "100%",
        );

        function loadExecutionPlan() {
            if (executionPlanState && executionPlanState.executionPlanGraphs) {
                const executionPlanRootNode =
                    executionPlanState.executionPlanGraphs[graphIndex].root;
                const executionPlanView = new ExecutionPlanView(executionPlanRootNode);

                setExecutionPlanView(executionPlanView);
                setIsExecutionPlanLoaded(true);
                const graph = executionPlanView.populate(executionPlanRootNode);
                setRenderedExecutionPlanGraph(graph);
                setFindNodeOptions(executionPlanView.getUniqueElementProperties());

                let tempQuery = executionPlanState.executionPlanGraphs[graphIndex].query;
                if (graphIndex != 0) {
                    const firstAlphaIndex = tempQuery.search(/[a-zA-Z]/);

                    if (firstAlphaIndex !== -1) {
                        tempQuery = tempQuery.slice(firstAlphaIndex);
                    }
                }
                setQuery(tempQuery);
                setXml(
                    executionPlanState.executionPlanGraphs[graphIndex].graphFile.graphFileContent,
                );
                setCost(executionPlanView.getTotalRelativeCost());
            } else {
                return;
            }
        }
        loadExecutionPlan();
    }, [executionPlanState]);

    const handleFlowReady = useCallback(
        ({ controller }: { controller: Parameters<ExecutionPlanView["setDiagram"]>[0] }) => {
            if (!executionPlanView) {
                return;
            }

            executionPlanView.setDiagram(controller);
            setExecutionPlanView(executionPlanView);
        },
        [executionPlanView],
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
        const percentage = (cost / executionPlanState!.totalCost!) * 100;
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
                    aria-label={`${getQueryCostString()}, ${query}`}>
                    <div className={classes.queryCostText}>{getQueryCostString()}</div>
                    <div className={classes.queryText} title={query}>
                        {query}
                    </div>
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
                    {renderedExecutionPlanGraph && (
                        <ExecutionPlanFlow
                            graph={renderedExecutionPlanGraph}
                            graphIndex={graphIndex}
                            themeKind={themeKind}
                            onReady={handleFlowReady}
                        />
                    )}
                </div>
                {customZoomClicked && (
                    <div
                        id="customZoomInputContainer"
                        className={classes.inputContainer}
                        style={{
                            background: tokens.colorNeutralBackground1,
                        }}
                        tabIndex={0}>
                        <span>{locConstants.executionPlan.customZoom}</span>
                        <div className={classes.spacer}></div>
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
                )}
                {findNodeClicked && (
                    <div tabIndex={0}>
                        <FindNode
                            // guaranteed to be non-null, because the plan will only
                            // show if it's non-null
                            executionPlanView={executionPlanView!}
                            setExecutionPlanView={setExecutionPlanView}
                            findNodeOptions={findNodeOptions}
                            setFindNodeClicked={setFindNodeClicked}
                            inputRef={inputRef}
                        />
                    </div>
                )}
                {highlightOpsClicked && (
                    <div tabIndex={0}>
                        <HighlightExpensiveOperations
                            // guaranteed to be non-null
                            executionPlanView={executionPlanView!}
                            setExecutionPlanView={setExecutionPlanView}
                            setHighlightOpsClicked={setHighlightOpsClicked}
                            inputRef={inputRef}
                        />
                    </div>
                )}
                {propertiesClicked && (
                    <div
                        className={classes.resizable}
                        style={{ width: `${propertiesWidth}px` }}
                        ref={resizableRef}>
                        <div className={classes.resizer} onMouseDown={onMouseDown}></div>
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
            <IconStack
                executionPlanView={executionPlanView!}
                setExecutionPlanView={setExecutionPlanView}
                setZoomNumber={setZoomNumber}
                setCustomZoomClicked={setCustomZoomClicked}
                setFindNodeClicked={setFindNodeClicked}
                setHighlightOpsClicked={setHighlightOpsClicked}
                setPropertiesClicked={setPropertiesClicked}
                query={query}
                xml={xml}
            />
        </div>
    );
};
