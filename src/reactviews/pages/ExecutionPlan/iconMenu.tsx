/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from "./queryPlanSetup";
import "./executionPlan.css";
import { makeStyles, Toolbar, ToolbarButton } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    iconStack: {
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "25px",
        opacity: 1,
        zIndex: "1",
        position: "absolute",
        height: "100%",
    },
    button: {
        cursor: "pointer",
    },
    buttonImg: {
        display: "block",
        height: "16px",
        width: "16px",
    },
    seperator: {
        width: "100%",
        height: "2px",
        border: "none",
    },
});

interface IconStackProps {
    executionPlanView: any;
    setExecutionPlanView: any;
    setZoomNumber: any;
    setCustomZoomClicked: any;
    setFindNodeClicked: any;
    setHighlightOpsClicked: any;
    setPropertiesClicked: any;
    query: any;
}

export const IconStack: React.FC<IconStackProps> = ({
    executionPlanView,
    setExecutionPlanView,
    setZoomNumber,
    setCustomZoomClicked,
    setFindNodeClicked,
    setHighlightOpsClicked,
    setPropertiesClicked,
    query,
}) => {
    const classes = useStyles();
    const state = useContext(ExecutionPlanContext);
    const executionPlanState = state?.state;
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
    enum InputEnum {
        CustomZoom,
        FindNode,
        HighlightOps,
        Properties,
    }

    const SAVE_PLAN = locConstants.executionPlan.savePlan;
    const OPEN_XML = locConstants.executionPlan.openXml;
    const OPEN_QUERY = locConstants.executionPlan.openQuery;
    const ZOOM_IN = locConstants.executionPlan.zoomIn;
    const ZOOM_OUT = locConstants.executionPlan.zoomOut;
    const ZOOM_TO_FIT = locConstants.executionPlan.zoomToFit;
    const CUSTOM_ZOOM = locConstants.executionPlan.customZoom;
    const FIND_NODE = locConstants.executionPlan.findNode;
    const PROPERTIES = locConstants.executionPlan.properties;
    const HIGHLIGHT_OPS =
        locConstants.executionPlan.highlightExpensiveOperation;
    const TOGGLE_TOOLTIPS = locConstants.executionPlan.toggleTooltips;

    const handleSavePlan = async () => {
        await state!.provider.saveExecutionPlan(
            executionPlanState!.sqlPlanContent!,
        );
    };

    const handleShowXml = async () => {
        await state!.provider.showPlanXml(executionPlanState!.sqlPlanContent!);
    };

    const handleShowQuery = async () => {
        await state!.provider.showQuery(query);
    };

    const handleZoomIn = async () => {
        if (executionPlanView) {
            executionPlanView.zoomIn();
            setExecutionPlanView(executionPlanView);
            setZoomNumber(executionPlanView.getZoomLevel());
        }
    };

    const handleZoomOut = async () => {
        if (executionPlanView) {
            executionPlanView.zoomOut();
            setExecutionPlanView(executionPlanView);
            setZoomNumber(executionPlanView.getZoomLevel());
        }
    };

    const handleZoomToFit = async () => {
        if (executionPlanView) {
            executionPlanView.zoomToFit();
            setExecutionPlanView(executionPlanView);
            setZoomNumber(executionPlanView.getZoomLevel());
        }
    };

    const handleToggleTooltips = async () => {
        if (executionPlanView) {
            executionPlanView.toggleTooltip();
            setExecutionPlanView(executionPlanView);
            setTooltipsEnabled(!tooltipsEnabled);
        }
    };

    const setInputContainer = (inputType: InputEnum) => {
        if (inputType == InputEnum.CustomZoom) {
            setFindNodeClicked(false);
            setHighlightOpsClicked(false);
            setPropertiesClicked(false);
            setCustomZoomClicked(true);
        } else if (inputType == InputEnum.FindNode) {
            setFindNodeClicked(true);
            setHighlightOpsClicked(false);
            setCustomZoomClicked(false);
            setPropertiesClicked(false);
        } else if (inputType == InputEnum.HighlightOps) {
            setFindNodeClicked(false);
            setHighlightOpsClicked(true);
            setCustomZoomClicked(false);
            setPropertiesClicked(false);
        } else {
            setFindNodeClicked(false);
            setHighlightOpsClicked(false);
            setCustomZoomClicked(false);
            setPropertiesClicked(true);
        }
    };

    return (
        <Toolbar
            className={classes.iconStack}
            style={{
                background: `${utils.background(executionPlanState!.theme!)}`,
            }}
            vertical
        >
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.save(executionPlanState!.theme!)}
                        alt={SAVE_PLAN}
                    />
                }
                onClick={handleSavePlan}
                title={SAVE_PLAN}
                aria-label={SAVE_PLAN}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.openPlanFile(executionPlanState!.theme!)}
                        alt={OPEN_XML}
                    />
                }
                onClick={handleShowXml}
                title={OPEN_XML}
                aria-label={OPEN_XML}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.openQuery(executionPlanState!.theme!)}
                        alt={OPEN_QUERY}
                    />
                }
                onClick={handleShowQuery}
                title={OPEN_QUERY}
                aria-label={OPEN_QUERY}
            />
            <hr
                className={classes.seperator}
                style={{
                    background: utils.seperator(executionPlanState!.theme!),
                }}
            ></hr>
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.zoomIn(executionPlanState!.theme!)}
                        alt={ZOOM_IN}
                    />
                }
                onClick={handleZoomIn}
                title={ZOOM_IN}
                aria-label={ZOOM_IN}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.zoomOut(executionPlanState!.theme!)}
                        alt={ZOOM_OUT}
                    />
                }
                onClick={handleZoomOut}
                title={ZOOM_OUT}
                aria-label={ZOOM_OUT}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.zoomToFit(executionPlanState!.theme!)}
                        alt={ZOOM_TO_FIT}
                    />
                }
                onClick={handleZoomToFit}
                title={ZOOM_TO_FIT}
                aria-label={ZOOM_TO_FIT}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.customZoom(executionPlanState!.theme!)}
                        alt={CUSTOM_ZOOM}
                    />
                }
                onClick={() => setInputContainer(InputEnum.CustomZoom)}
                title={CUSTOM_ZOOM}
                aria-label={CUSTOM_ZOOM}
            />
            <hr
                className={classes.seperator}
                style={{
                    background: utils.seperator(executionPlanState!.theme!),
                }}
            ></hr>
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.search(executionPlanState!.theme!)}
                        alt={FIND_NODE}
                    />
                }
                onClick={() => setInputContainer(InputEnum.FindNode)}
                title={FIND_NODE}
                aria-label={FIND_NODE}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.properties(executionPlanState!.theme!)}
                        alt={PROPERTIES}
                    />
                }
                onClick={() => setInputContainer(InputEnum.Properties)}
                title={PROPERTIES}
                aria-label={PROPERTIES}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.highlightOps(executionPlanState!.theme!)}
                        alt={HIGHLIGHT_OPS}
                    />
                }
                onClick={() => setInputContainer(InputEnum.HighlightOps)}
                title={HIGHLIGHT_OPS}
                aria-label={HIGHLIGHT_OPS}
                role="button"
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={
                            tooltipsEnabled
                                ? utils.enableTooltip(
                                      executionPlanState!.theme!,
                                  )
                                : utils.disableTooltip(
                                      executionPlanState!.theme!,
                                  )
                        }
                        alt={TOGGLE_TOOLTIPS}
                    />
                }
                onClick={handleToggleTooltips}
                title={TOGGLE_TOOLTIPS}
                aria-label={TOGGLE_TOOLTIPS}
                role="button"
            />
        </Toolbar>
    );
};
