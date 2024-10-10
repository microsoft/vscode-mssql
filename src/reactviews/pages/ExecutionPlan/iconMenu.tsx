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
import { QueryResultState } from "../QueryResult/queryResultStateProvider";
import { ExecutionPlanView } from "./executionPlanView";

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
    executionPlanView: ExecutionPlanView;
    setExecutionPlanView: any;
    setZoomNumber: any;
    setCustomZoomClicked: any;
    setFindNodeClicked: any;
    setHighlightOpsClicked: any;
    setPropertiesClicked: any;
    query: string;
    xml: string;
    context?: QueryResultState;
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
    xml,
    context,
}) => {
    const classes = useStyles();
    const state = context ?? useContext(ExecutionPlanContext);
    const theme = state!.theme;
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
        await state!.provider.saveExecutionPlan(xml);
    };

    const handleShowXml = async () => {
        await state!.provider.showPlanXml(xml);
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
                background: `${theme.colorNeutralBackground2}`,
                minHeight: "300px",
            }}
            vertical
        >
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.save(theme.colorNeutralBackground2)}
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
                        src={utils.openPlanFile(theme.colorNeutralBackground2)}
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
                        src={utils.openQuery(theme.colorNeutralBackground2)}
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
                    background: theme.colorNeutralStroke1,
                }}
            ></hr>
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.zoomIn(theme.colorNeutralBackground2)}
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
                        src={utils.zoomOut(theme.colorNeutralBackground2)}
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
                        src={utils.zoomToFit(theme.colorNeutralBackground2)}
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
                        src={utils.customZoom(theme.colorNeutralBackground2)}
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
                    background: theme.colorNeutralStroke1,
                }}
            ></hr>
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.search(theme.colorNeutralBackground2)}
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
                        src={utils.properties(theme.colorNeutralBackground2)}
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
                        src={utils.highlightOps(theme.colorNeutralBackground2)}
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
                                      theme.colorNeutralBackground2,
                                  )
                                : utils.disableTooltip(
                                      theme.colorNeutralBackground2,
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
