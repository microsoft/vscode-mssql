/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from "./queryPlanSetup";
import * as azdataGraph from "azdataGraph/dist/build";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./executionPlan.css";
import { Button, Input, makeStyles, Popover } from "@fluentui/react-components";
import { ExecutionPlanView } from "./executionPlanView";
import { Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { IconStack } from "./iconMenu";
import { FindNode } from "./findNodes";
import { HighlightExpensiveOperations } from "./highlightExpensiveOperations";
import { locConstants } from "../../common/locConstants";
import { PropertiesPane } from "./properties";

const useStyles = makeStyles({
    panelContainer: {
        display: "flex",
        flexDirection: "row",
        width: "100%",
        position: "relative",
    },
    planContainer: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        width: "100%",
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
    queryCostContainer: {
        opacity: 1,
        padding: "5px",
    },
    queryPlanParent: {
        opacity: 1,
        height: "100%",
        width: "100%",
        overflow: "auto",
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
});

interface ExecutionPlanGraphProps {
    graphIndex: number;
}

export const ExecutionPlanGraph: React.FC<ExecutionPlanGraphProps> = ({
    graphIndex,
}) => {
    const classes = useStyles();
    const state = useContext(ExecutionPlanContext);
    const executionPlanState = state?.state;
    const [isExecutionPlanLoaded, setIsExecutionPlanLoaded] = useState(false);
    const [query, setQuery] = useState("");
    const [cost, setCost] = useState(0);
    const [executionPlanView, setExecutionPlanView] =
        useState<ExecutionPlanView | null>(null);
    const [zoomNumber, setZoomNumber] = useState(100);
    const [customZoomClicked, setCustomZoomClicked] = useState(false);
    const [findNodeClicked, setFindNodeClicked] = useState(false);
    const [findNodeOptions, setFindNodeOptions] = useState<string[]>([]);
    const [highlightOpsClicked, setHighlightOpsClicked] = useState(false);
    const [propertiesClicked, setPropertiesClicked] = useState(false);
    const [propertiesWidth, setPropertiesWidth] = useState(400);
    const [containerHeight, setContainerHeight] = useState("100%");
    const resizableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!executionPlanState || isExecutionPlanLoaded) return;

        setContainerHeight(
            executionPlanState!.executionPlanGraphs!.length > 1
                ? "500px"
                : "100%",
        );

        // @ts-ignore
        window["mxLoadResources"] = false;
        // @ts-ignore
        window["mxForceIncludes"] = false;
        // @ts-ignore
        window["mxResourceExtension"] = ".txt";
        // @ts-ignore
        window["mxLoadStylesheets"] = false;
        // @ts-ignore
        window["mxBasePath"] = "./src/reactviews/pages/ExecutionPlan/mxgraph";

        const mxClient = azdataGraph.default();

        function loadExecutionPlan() {
            if (executionPlanState && executionPlanState.executionPlanGraphs) {
                const executionPlanRootNode =
                    executionPlanState.executionPlanGraphs[graphIndex].root;
                const executionPlanView = new ExecutionPlanView(
                    executionPlanRootNode,
                );
                const executionPlanGraph = executionPlanView.populate(
                    executionPlanRootNode,
                );

                const div = document.getElementById(
                    `queryPlanParent${graphIndex + 1}`,
                );
                // create a div to hold the graph
                const queryPlanConfiguration = {
                    container: div,
                    queryPlanGraph: executionPlanGraph,
                    iconPaths: utils.getIconPaths(),
                    badgeIconPaths: utils.getBadgePaths(),
                    expandCollapsePaths: utils.getCollapseExpandPaths(),
                    showTooltipOnClick: true,
                };
                const pen = new mxClient.azdataQueryPlan(
                    queryPlanConfiguration,
                );
                pen.setTextFontColor("var(--vscode-editor-foreground)"); // set text color
                pen.setEdgeColor("var(--vscode-editor-foreground)"); // set edge color

                executionPlanView.setDiagram(pen);

                setExecutionPlanView(executionPlanView);
                setIsExecutionPlanLoaded(true);
                setFindNodeOptions(
                    executionPlanView.getUniqueElementProperties(),
                );

                let tempQuery =
                    executionPlanState.executionPlanGraphs[graphIndex].query;
                if (graphIndex != 0) {
                    const firstAlphaIndex = tempQuery.search(/[a-zA-Z]/);

                    if (firstAlphaIndex !== -1) {
                        tempQuery = tempQuery.slice(firstAlphaIndex);
                    }
                }
                setQuery(tempQuery);
                setCost(executionPlanView.getTotalRelativeCost());
            } else {
                return;
            }
        }
        loadExecutionPlan();
    }, [executionPlanState]);

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

    // this is for resizing the properties panel
    const onMouseDown = (e: any) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = resizableRef!.current!.offsetWidth;

        const onMouseMove = (e: any) => {
            const newWidth = startWidth - (e.pageX - startX);
            setPropertiesWidth(newWidth);
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
            style={{ height: containerHeight }}
        >
            <div
                id="planContainer"
                className={classes.planContainer}
                style={{ height: containerHeight }}
            >
                <div
                    id="queryCostContainer"
                    className={classes.queryCostContainer}
                    style={{
                        background: utils.background(
                            executionPlanState!.theme!,
                        ),
                    }}
                >
                    {locConstants.executionPlan.queryCostRelativeToScript(
                        graphIndex + 1,
                        getQueryCostPercentage(),
                    )}
                    <br />
                    {query}
                </div>
                <div
                    id={`queryPlanParent${graphIndex + 1}`}
                    className={classes.queryPlanParent}
                    style={{
                        // 35px is the width of the side toolbar with some extra room for padding
                        width: propertiesClicked
                            ? `calc(100% - ${propertiesWidth}px - 35px)`
                            : "calc(100% - 35px)",
                    }}
                ></div>
                <Popover open={customZoomClicked}>
                    <div
                        id="customZoomInputContainer"
                        className={classes.inputContainer}
                        style={{
                            background: utils.iconBackground(
                                executionPlanState!.theme!,
                            ),
                        }}
                    >
                        <Input
                            id="customZoomInputBox"
                            type="number"
                            min={1}
                            defaultValue={Math.floor(zoomNumber).toString()}
                            onChange={(e) =>
                                setZoomNumber(Number(e.target.value))
                            }
                            style={{
                                width: "100px",
                                height: "25px",
                                fontSize: "12px",
                            }}
                        />
                        <Button
                            onClick={handleCustomZoomInput}
                            icon={<Checkmark20Regular />}
                        />
                        <Button
                            icon={<Dismiss20Regular />}
                            onClick={() => setCustomZoomClicked(false)}
                        />
                    </div>
                </Popover>
                <Popover open={findNodeClicked}>
                    <FindNode
                        executionPlanView={executionPlanView}
                        setExecutionPlanView={setExecutionPlanView}
                        findNodeOptions={findNodeOptions}
                        setFindNodeClicked={setFindNodeClicked}
                    />
                </Popover>
                <Popover open={highlightOpsClicked}>
                    <HighlightExpensiveOperations
                        executionPlanView={executionPlanView}
                        setExecutionPlanView={setExecutionPlanView}
                        setHighlightOpsClicked={setHighlightOpsClicked}
                    />
                </Popover>
                {propertiesClicked && (
                    <div
                        className={classes.resizable}
                        style={{ width: `${propertiesWidth}px` }}
                        ref={resizableRef}
                    >
                        <div
                            className={classes.resizer}
                            onMouseDown={onMouseDown}
                        ></div>
                        <Popover open={propertiesClicked}>
                            <PropertiesPane
                                executionPlanView={executionPlanView}
                                setPropertiesClicked={setPropertiesClicked}
                            />
                        </Popover>
                    </div>
                )}
            </div>
            <IconStack
                executionPlanView={executionPlanView}
                setExecutionPlanView={setExecutionPlanView}
                setZoomNumber={setZoomNumber}
                setCustomZoomClicked={setCustomZoomClicked}
                setFindNodeClicked={setFindNodeClicked}
                setHighlightOpsClicked={setHighlightOpsClicked}
                setPropertiesClicked={setPropertiesClicked}
                query={query}
            />
        </div>
    );
};
