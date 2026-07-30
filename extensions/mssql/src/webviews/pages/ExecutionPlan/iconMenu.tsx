/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import {
    makeStyles,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    tokens,
} from "@fluentui/react-components";
import {
    DocumentBulletListFilled,
    DocumentBulletListRegular,
    SaveRegular,
    SearchFilled,
    SearchRegular,
    ZoomFitRegular,
    ZoomInRegular,
    ZoomOutRegular,
} from "@fluentui/react-icons";
import { Dispatch, SetStateAction, useContext, useState } from "react";

import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import {
    DocumentCodeIcon16Regular,
    HighlightExpensiveOperationIcon16Regular,
    OpenQueryIcon16Regular,
    TooltipIcon16Regular,
    TooltipOffIcon16Regular,
    ZoomControlIcon16Regular,
} from "../../common/icons/executionPlanIcons";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    iconStack: {
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        boxSizing: "border-box",
        width: "35px",
        paddingTop: "2px",
        paddingRight: "1px",
        paddingBottom: "2px",
        paddingLeft: "1px",
        rowGap: "0",
        opacity: 1,
        zIndex: "1",
        position: "absolute",
        height: "100%",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    button: {
        minWidth: "32px",
        width: "32px",
        height: "32px",
        cursor: "pointer",
    },
    selectedButton: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    icon: {
        width: "20px",
        height: "20px",
        fontSize: "20px",
    },
    divider: {
        flexGrow: 0,
        alignSelf: "center",
        boxSizing: "border-box",
        width: "24px",
        minWidth: "24px",
        height: "1px",
        minHeight: "1px",
        paddingTop: "0",
        paddingRight: "0",
        paddingBottom: "0",
        paddingLeft: "0",
        marginTop: "4px",
        marginBottom: "4px",
    },
});

interface IconStackProps {
    executionPlanView: ExecutionPlanGraphController;
    setExecutionPlanView: Dispatch<SetStateAction<ExecutionPlanGraphController | null>>;
    setZoomNumber: Dispatch<SetStateAction<number>>;
    customZoomClicked: boolean;
    setCustomZoomClicked: Dispatch<SetStateAction<boolean>>;
    findNodeClicked: boolean;
    setFindNodeClicked: Dispatch<SetStateAction<boolean>>;
    highlightOpsClicked: boolean;
    setHighlightOpsClicked: Dispatch<SetStateAction<boolean>>;
    propertiesClicked: boolean;
    setPropertiesClicked: Dispatch<SetStateAction<boolean>>;
    query: string;
    xml: string;
}

enum InputEnum {
    CustomZoom,
    FindNode,
    HighlightOps,
    Properties,
}

export const IconStack: React.FC<IconStackProps> = ({
    executionPlanView,
    setExecutionPlanView,
    setZoomNumber,
    customZoomClicked,
    setCustomZoomClicked,
    findNodeClicked,
    setFindNodeClicked,
    highlightOpsClicked,
    setHighlightOpsClicked,
    propertiesClicked,
    setPropertiesClicked,
    query,
    xml,
}) => {
    const classes = useStyles();
    const context = useContext(ExecutionPlanContext);

    if (!context) {
        return undefined;
    }

    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);

    const SAVE_PLAN = locConstants.executionPlan.savePlan;
    const OPEN_XML = locConstants.executionPlan.openXml;
    const OPEN_QUERY = locConstants.executionPlan.openQuery;
    const ZOOM_IN = locConstants.executionPlan.zoomIn;
    const ZOOM_OUT = locConstants.executionPlan.zoomOut;
    const ZOOM_TO_FIT = locConstants.executionPlan.zoomToFit;
    const CUSTOM_ZOOM = locConstants.executionPlan.customZoom;
    const FIND_NODE = locConstants.executionPlan.findNode;
    const PROPERTIES = locConstants.executionPlan.properties;
    const HIGHLIGHT_OPS = locConstants.executionPlan.highlightExpensiveOperation;
    const TOGGLE_TOOLTIPS = locConstants.executionPlan.toggleTooltips;

    const handleSavePlan = async () => {
        await context.saveExecutionPlan(xml);
    };

    const handleShowXml = async () => {
        await context.showPlanXml(xml);
    };

    const handleShowQuery = async () => {
        await context.showQuery(query);
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
            const enabled = executionPlanView.toggleTooltip();
            setExecutionPlanView(executionPlanView);
            setTooltipsEnabled(enabled);
        }
    };

    const setInputContainer = (inputType: InputEnum) => {
        setCustomZoomClicked(inputType === InputEnum.CustomZoom ? !customZoomClicked : false);
        setFindNodeClicked(inputType === InputEnum.FindNode ? !findNodeClicked : false);
        setHighlightOpsClicked(inputType === InputEnum.HighlightOps ? !highlightOpsClicked : false);
        setPropertiesClicked(inputType === InputEnum.Properties ? !propertiesClicked : false);
    };

    const buttonClassName = (selected = false) =>
        `${classes.button}${selected ? ` ${classes.selectedButton}` : ""}`;

    return (
        <Toolbar
            className={classes.iconStack}
            aria-label={locConstants.executionPlan.executionPlanToolbar}
            vertical>
            <ToolbarButton
                className={classes.button}
                icon={<SaveRegular className={classes.icon} />}
                onClick={handleSavePlan}
                title={SAVE_PLAN}
                aria-label={SAVE_PLAN}
            />
            <ToolbarButton
                className={classes.button}
                icon={<DocumentCodeIcon16Regular className={classes.icon} />}
                onClick={handleShowXml}
                title={OPEN_XML}
                aria-label={OPEN_XML}
            />
            <ToolbarButton
                className={classes.button}
                icon={<OpenQueryIcon16Regular className={classes.icon} />}
                onClick={handleShowQuery}
                title={OPEN_QUERY}
                aria-label={OPEN_QUERY}
            />
            <ToolbarDivider className={classes.divider} />
            <ToolbarButton
                className={classes.button}
                icon={<ZoomInRegular className={classes.icon} />}
                onClick={handleZoomIn}
                title={ZOOM_IN}
                aria-label={ZOOM_IN}
            />
            <ToolbarButton
                className={classes.button}
                icon={<ZoomOutRegular className={classes.icon} />}
                onClick={handleZoomOut}
                title={ZOOM_OUT}
                aria-label={ZOOM_OUT}
            />
            <ToolbarButton
                className={classes.button}
                icon={<ZoomFitRegular className={classes.icon} />}
                onClick={handleZoomToFit}
                title={ZOOM_TO_FIT}
                aria-label={ZOOM_TO_FIT}
            />
            <ToolbarButton
                className={buttonClassName(customZoomClicked)}
                icon={<ZoomControlIcon16Regular className={classes.icon} />}
                onClick={() => setInputContainer(InputEnum.CustomZoom)}
                title={CUSTOM_ZOOM}
                aria-label={CUSTOM_ZOOM}
                aria-pressed={customZoomClicked}
            />
            <ToolbarDivider className={classes.divider} />
            <ToolbarButton
                className={buttonClassName(findNodeClicked)}
                icon={
                    findNodeClicked ? (
                        <SearchFilled className={classes.icon} />
                    ) : (
                        <SearchRegular className={classes.icon} />
                    )
                }
                onClick={() => setInputContainer(InputEnum.FindNode)}
                title={FIND_NODE}
                aria-label={FIND_NODE}
                aria-pressed={findNodeClicked}
            />
            <ToolbarButton
                className={buttonClassName(propertiesClicked)}
                icon={
                    propertiesClicked ? (
                        <DocumentBulletListFilled className={classes.icon} />
                    ) : (
                        <DocumentBulletListRegular className={classes.icon} />
                    )
                }
                onClick={() => setInputContainer(InputEnum.Properties)}
                title={PROPERTIES}
                aria-label={PROPERTIES}
                aria-pressed={propertiesClicked}
            />
            <ToolbarButton
                className={buttonClassName(highlightOpsClicked)}
                icon={<HighlightExpensiveOperationIcon16Regular className={classes.icon} />}
                onClick={() => setInputContainer(InputEnum.HighlightOps)}
                title={HIGHLIGHT_OPS}
                aria-label={HIGHLIGHT_OPS}
                aria-pressed={highlightOpsClicked}
            />
            <ToolbarButton
                className={buttonClassName(tooltipsEnabled)}
                icon={
                    tooltipsEnabled ? (
                        <TooltipIcon16Regular className={classes.icon} />
                    ) : (
                        <TooltipOffIcon16Regular className={classes.icon} />
                    )
                }
                onClick={handleToggleTooltips}
                title={TOGGLE_TOOLTIPS}
                aria-label={TOGGLE_TOOLTIPS}
                aria-pressed={tooltipsEnabled}
            />
        </Toolbar>
    );
};
