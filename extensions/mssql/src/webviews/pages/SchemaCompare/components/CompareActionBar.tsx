/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { Button, Toolbar, ToolbarDivider, makeStyles } from "@fluentui/react-components";

import {
    ArrowSwap16Filled,
    ColumnDoubleCompare20Regular,
    DocumentArrowUp16Regular,
    DocumentChevronDouble20Regular,
    Play16Filled,
    Save16Regular,
    Settings16Regular,
    Stop16Filled,
} from "@fluentui/react-icons";

import { locConstants as loc } from "../../../common/locConstants";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { SchemaCompareEndpointType } from "../../../../sharedInterfaces/schemaCompare";
import { SchemaCompareApplyDialog } from "./SchemaCompareApplyDialog";

interface Props {
    onOptionsClicked: () => void;
}

const TOOLBAR_HYSTERESIS = 10;

const useStyles = makeStyles({
    toolbarContainer: {
        width: "100%",
        minHeight: "32px",
        padding: "2px 0",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    toolbar: {
        width: "100%",
        overflowX: "hidden",
        overflowY: "hidden",
        alignItems: "center",
        gap: "2px",
        flexWrap: "nowrap",
        "& .fui-Button": {
            whiteSpace: "nowrap",
            flexShrink: 0,
        },
    },
});

const CompareActionBar = (props: Props) => {
    const classes = useStyles();
    const toolbarRef = useRef<HTMLDivElement | null>(undefined as unknown as HTMLDivElement | null);
    const fullWidthRef = useRef(0);
    const [isCompact, setIsCompact] = useState(false);
    const context = useContext(schemaCompareContext);
    const endpointsSwitched = useSchemaCompareSelector((s) => s.endpointsSwitched);
    const sourceEndpointInfo = useSchemaCompareSelector((s) => s.sourceEndpointInfo);
    const targetEndpointInfo = useSchemaCompareSelector((s) => s.targetEndpointInfo);
    const defaultDeploymentOptionsResult = useSchemaCompareSelector(
        (s) => s.defaultDeploymentOptionsResult,
    );
    const isComparisonInProgress = useSchemaCompareSelector((s) => s.isComparisonInProgress);
    const isApplyInProgress = useSchemaCompareSelector((s) => s.isApplyInProgress);
    const isEndpointSelectionInProgress = useSchemaCompareSelector(
        (s) => s.isEndpointSelectionInProgress === true,
    );
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const differences = context.differences;

    useLayoutEffect(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar) {
            return;
        }

        const check = () => {
            if (isCompact) {
                if (toolbar.clientWidth >= fullWidthRef.current + TOOLBAR_HYSTERESIS) {
                    setIsCompact(false);
                }
            } else {
                fullWidthRef.current = toolbar.scrollWidth;
                if (toolbar.scrollWidth > toolbar.clientWidth + 1) {
                    setIsCompact(true);
                }
            }
        };

        check();
        const observer = new ResizeObserver(check);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, [isCompact]);

    useEffect(() => {
        if (endpointsSwitched) {
            if (sourceEndpointInfo && targetEndpointInfo && !isEndpointSelectionInProgress) {
                handleCompare();
            } else {
                // Reset the flag when comparison doesn't run so subsequent switches trigger the effect
                context.resetEndpointsSwitched();
            }
        }
    }, [endpointsSwitched, isEndpointSelectionInProgress]);

    const handleCompare = () => {
        if (isEndpointSelectionInProgress) {
            return;
        }

        context.compare(
            sourceEndpointInfo,
            targetEndpointInfo,
            defaultDeploymentOptionsResult.defaultDeploymentOptions,
        );
    };

    const handleStop = () => {
        context.cancel();
    };

    const handleGenerateScript = () => {
        context.generateScript(targetEndpointInfo.serverName, targetEndpointInfo.databaseName);
    };

    const handlePublishChanges = () => {
        context.publishChanges(targetEndpointInfo.serverName, targetEndpointInfo.databaseName);
    };

    const handleOptionsClicked = () => {
        props.onOptionsClicked();
    };

    const handleSwitchEndpoints = () => {
        context.switchEndpoints(targetEndpointInfo, sourceEndpointInfo);
    };

    const handleOpenScmp = () => {
        context.openScmp();
    };

    const handleSaveScmp = () => {
        context.saveScmp();
    };

    const isEndpointEmpty = (endpoint: mssql.SchemaCompareEndpointInfo): boolean => {
        return !(
            endpoint &&
            (endpoint.serverDisplayName || endpoint.packageFilePath || endpoint.projectFilePath)
        );
    };

    const hasIncludedDiffs = (): boolean => {
        return differences.some((diff) => diff.included);
    };

    const disableGenerateScriptButton = (): boolean => {
        if (
            !(
                targetEndpointInfo &&
                Number(targetEndpointInfo.endpointType) === SchemaCompareEndpointType.Database
            )
        ) {
            return true;
        } else if (isComparisonInProgress) {
            return true;
        } else if (schemaCompareResult === undefined || differences.length === 0) {
            return true;
        }

        if (!hasIncludedDiffs()) {
            return true;
        }

        return false;
    };

    const disableApplyButton = (): boolean => {
        if (
            targetEndpointInfo &&
            schemaCompareResult &&
            differences.length > 0 &&
            Number(targetEndpointInfo.endpointType) !== SchemaCompareEndpointType.Dacpac
        ) {
            if (!hasIncludedDiffs()) {
                return true;
            }

            return false;
        }

        return true;
    };

    const isCheckboxOperationInProgress =
        context.isIncludeExcludeAllInProgress || context.pendingDifferenceIds.size > 0;
    const isApplyDisabled =
        isComparisonInProgress ||
        isApplyInProgress ||
        isCheckboxOperationInProgress ||
        disableApplyButton();
    const applyButton = (
        <Button
            size="small"
            appearance="subtle"
            aria-label={loc.schemaCompare.apply}
            title={loc.schemaCompare.applyChangesToTarget}
            icon={<Play16Filled />}
            disabled={isApplyDisabled}>
            {!isCompact && loc.schemaCompare.apply}
        </Button>
    );

    return (
        <div className={classes.toolbarContainer}>
            <Toolbar ref={toolbarRef} size="small" className={classes.toolbar}>
                <Button
                    size="small"
                    appearance="primary"
                    aria-label={loc.schemaCompare.compare}
                    title={loc.schemaCompare.compare}
                    icon={<ColumnDoubleCompare20Regular />}
                    onClick={handleCompare}
                    disabled={
                        isEndpointEmpty(sourceEndpointInfo) ||
                        isEndpointEmpty(targetEndpointInfo) ||
                        isComparisonInProgress ||
                        isApplyInProgress ||
                        isEndpointSelectionInProgress ||
                        isCheckboxOperationInProgress
                    }>
                    {!isCompact && loc.schemaCompare.compare}
                </Button>
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.stop}
                    title={loc.schemaCompare.stop}
                    icon={<Stop16Filled />}
                    onClick={handleStop}
                    disabled={!isComparisonInProgress || isApplyInProgress}>
                    {!isCompact && loc.schemaCompare.stop}
                </Button>
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.generateScript}
                    title={loc.schemaCompare.generateScriptToDeployChangesToTarget}
                    icon={<DocumentChevronDouble20Regular />}
                    onClick={handleGenerateScript}
                    disabled={
                        disableGenerateScriptButton() ||
                        isApplyInProgress ||
                        isCheckboxOperationInProgress
                    }>
                    {!isCompact && loc.schemaCompare.generateScript}
                </Button>
                {targetEndpointInfo && schemaCompareResult ? (
                    <SchemaCompareApplyDialog
                        targetEndpoint={targetEndpointInfo}
                        differences={differences}
                        onApply={handlePublishChanges}
                        disabled={isApplyDisabled}>
                        {applyButton}
                    </SchemaCompareApplyDialog>
                ) : (
                    applyButton
                )}
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.options}
                    title={loc.schemaCompare.options}
                    icon={<Settings16Regular />}
                    onClick={handleOptionsClicked}
                    disabled={
                        isComparisonInProgress ||
                        isApplyInProgress ||
                        isCheckboxOperationInProgress ||
                        isEndpointEmpty(sourceEndpointInfo) ||
                        isEndpointEmpty(targetEndpointInfo)
                    }>
                    {!isCompact && loc.schemaCompare.options}
                </Button>
                <ToolbarDivider />
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.switchDirection}
                    title={loc.schemaCompare.switchSourceAndTarget}
                    icon={<ArrowSwap16Filled />}
                    onClick={handleSwitchEndpoints}
                    disabled={
                        isComparisonInProgress ||
                        isApplyInProgress ||
                        isCheckboxOperationInProgress ||
                        (isEndpointEmpty(sourceEndpointInfo) && isEndpointEmpty(targetEndpointInfo))
                    }>
                    {!isCompact && loc.schemaCompare.switchDirection}
                </Button>
                <ToolbarDivider />
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.openScmpFile}
                    title={loc.schemaCompare.loadSourceTargetAndOptionsSavedInAnScmpFile}
                    icon={<DocumentArrowUp16Regular />}
                    onClick={handleOpenScmp}
                    disabled={
                        isComparisonInProgress || isApplyInProgress || isCheckboxOperationInProgress
                    }>
                    {!isCompact && loc.schemaCompare.openScmpFile}
                </Button>
                <Button
                    size="small"
                    appearance="subtle"
                    aria-label={loc.schemaCompare.saveScmpFile}
                    title={loc.schemaCompare.saveSourceAndTargetOptionsAndExcludedElements}
                    icon={<Save16Regular />}
                    onClick={handleSaveScmp}
                    disabled={
                        isComparisonInProgress ||
                        isApplyInProgress ||
                        isCheckboxOperationInProgress ||
                        isEndpointEmpty(sourceEndpointInfo) ||
                        isEndpointEmpty(targetEndpointInfo)
                    }>
                    {!isCompact && loc.schemaCompare.saveScmpFile}
                </Button>
            </Toolbar>
        </div>
    );
};

export default CompareActionBar;
