/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import * as utils from "./queryPlanSetup";

import { Toolbar, ToolbarButton, makeStyles, tokens } from "@fluentui/react-components";
import { Dispatch, SetStateAction, useContext, useState } from "react";

import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

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
    separator: {
        width: "100%",
        height: "2px",
        border: "none",
    },
});

interface LegacyIconStackProps {
    executionPlanView: ExecutionPlanGraphController;
    setExecutionPlanView: Dispatch<SetStateAction<ExecutionPlanGraphController | null>>;
    setZoomNumber: Dispatch<SetStateAction<number>>;
    onZoomChange?: (zoomPercent: number) => void;
    setCustomZoomClicked: Dispatch<SetStateAction<boolean>>;
    setFindNodeClicked: Dispatch<SetStateAction<boolean>>;
    setHighlightOpsClicked: Dispatch<SetStateAction<boolean>>;
    setPropertiesClicked: Dispatch<SetStateAction<boolean>>;
    query: string;
    xml: string;
}

enum InputType {
    CustomZoom,
    FindNode,
    HighlightOperations,
    Properties,
}

export const LegacyIconStack: React.FC<LegacyIconStackProps> = ({
    executionPlanView,
    setExecutionPlanView,
    setZoomNumber,
    onZoomChange,
    setCustomZoomClicked,
    setFindNodeClicked,
    setHighlightOpsClicked,
    setPropertiesClicked,
    query,
    xml,
}) => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview();
    const context = useContext(ExecutionPlanContext);
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);

    if (!context) {
        return undefined;
    }

    const handleZoom = (operation: () => void) => {
        operation();
        setExecutionPlanView(executionPlanView);
        const zoomPercent = executionPlanView.getZoomLevel();
        setZoomNumber(zoomPercent);
        onZoomChange?.(zoomPercent);
    };

    const setInputContainer = (inputType: InputType) => {
        setCustomZoomClicked(inputType === InputType.CustomZoom);
        setFindNodeClicked(inputType === InputType.FindNode);
        setHighlightOpsClicked(inputType === InputType.HighlightOperations);
        setPropertiesClicked(inputType === InputType.Properties);
    };

    const handleToggleTooltips = () => {
        executionPlanView.toggleTooltip();
        setExecutionPlanView(executionPlanView);
        setTooltipsEnabled((enabled) => !enabled);
    };

    const image = (src: string, label: string) => (
        <img className={classes.buttonImg} src={src} alt={label} />
    );

    const separator = (
        <hr
            className={classes.separator}
            style={{
                background: tokens.colorNeutralStroke1,
            }}
        />
    );

    return (
        <Toolbar
            className={classes.iconStack}
            style={{
                background: tokens.colorNeutralBackground2,
                minHeight: "300px",
            }}
            aria-label={locConstants.executionPlan.executionPlanToolbar}
            vertical>
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.save(themeKind), locConstants.executionPlan.savePlan)}
                onClick={() => context.saveExecutionPlan(xml)}
                title={locConstants.executionPlan.savePlan}
                aria-label={locConstants.executionPlan.savePlan}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.openPlanFile(themeKind), locConstants.executionPlan.openXml)}
                onClick={() => context.showPlanXml(xml)}
                title={locConstants.executionPlan.openXml}
                aria-label={locConstants.executionPlan.openXml}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.openQuery(themeKind), locConstants.executionPlan.openQuery)}
                onClick={() => context.showQuery(query)}
                title={locConstants.executionPlan.openQuery}
                aria-label={locConstants.executionPlan.openQuery}
            />
            {separator}
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.zoomIn(themeKind), locConstants.executionPlan.zoomIn)}
                onClick={() => handleZoom(() => executionPlanView.zoomIn())}
                title={locConstants.executionPlan.zoomIn}
                aria-label={locConstants.executionPlan.zoomIn}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.zoomOut(themeKind), locConstants.executionPlan.zoomOut)}
                onClick={() => handleZoom(() => executionPlanView.zoomOut())}
                title={locConstants.executionPlan.zoomOut}
                aria-label={locConstants.executionPlan.zoomOut}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.zoomToFit(themeKind), locConstants.executionPlan.zoomToFit)}
                onClick={() => handleZoom(() => executionPlanView.zoomToFit())}
                title={locConstants.executionPlan.zoomToFit}
                aria-label={locConstants.executionPlan.zoomToFit}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.customZoom(themeKind), locConstants.executionPlan.customZoom)}
                onClick={() => setInputContainer(InputType.CustomZoom)}
                title={locConstants.executionPlan.customZoom}
                aria-label={locConstants.executionPlan.customZoom}
            />
            {separator}
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.search(themeKind), locConstants.executionPlan.findNode)}
                onClick={() => setInputContainer(InputType.FindNode)}
                title={locConstants.executionPlan.findNode}
                aria-label={locConstants.executionPlan.findNode}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(utils.properties(themeKind), locConstants.executionPlan.properties)}
                onClick={() => setInputContainer(InputType.Properties)}
                title={locConstants.executionPlan.properties}
                aria-label={locConstants.executionPlan.properties}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(
                    utils.highlightOps(themeKind),
                    locConstants.executionPlan.highlightExpensiveOperation,
                )}
                onClick={() => setInputContainer(InputType.HighlightOperations)}
                title={locConstants.executionPlan.highlightExpensiveOperation}
                aria-label={locConstants.executionPlan.highlightExpensiveOperation}
            />
            <ToolbarButton
                className={classes.button}
                tabIndex={0}
                icon={image(
                    tooltipsEnabled
                        ? utils.enableTooltip(themeKind)
                        : utils.disableTooltip(themeKind),
                    locConstants.executionPlan.toggleTooltips,
                )}
                onClick={handleToggleTooltips}
                title={locConstants.executionPlan.toggleTooltips}
                aria-label={locConstants.executionPlan.toggleTooltips}
            />
        </Toolbar>
    );
};
