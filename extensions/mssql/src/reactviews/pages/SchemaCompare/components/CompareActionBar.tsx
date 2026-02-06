/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { Toolbar, ToolbarButton, ToolbarDivider } from "@fluentui/react-components";

import {
    ArrowSwapFilled,
    ColumnDoubleCompareRegular,
    DocumentArrowUpRegular,
    DocumentChevronDoubleRegular,
    PlayFilled,
    SaveRegular,
    SettingsRegular,
    StopFilled,
} from "@fluentui/react-icons";

import { locConstants as loc } from "../../../common/locConstants";
import { useContext, useEffect } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { SchemaCompareEndpointType } from "../../../../sharedInterfaces/schemaCompare";

interface Props {
    onOptionsClicked: () => void;
}

const CompareActionBar = (props: Props) => {
    const context = useContext(schemaCompareContext);
    const state = useSchemaCompareSelector((s) => s);

    useEffect(() => {
        if (state.endpointsSwitched) {
            if (state.sourceEndpointInfo && state.targetEndpointInfo) {
                handleCompare();
            } else {
                // Reset the flag when comparison doesn't run so subsequent switches trigger the effect
                context.resetEndpointsSwitched();
            }
        }
    }, [state.endpointsSwitched]);

    const handleCompare = () => {
        context.compare(
            state.sourceEndpointInfo,
            state.targetEndpointInfo,
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
        );
    };

    const handleStop = () => {
        context.cancel();
    };

    const handleGenerateScript = () => {
        context.generateScript(
            state.targetEndpointInfo.serverName,
            state.targetEndpointInfo.databaseName,
        );
    };

    const handlePublishChanges = () => {
        context.publishChanges(
            state.targetEndpointInfo.serverName,
            state.targetEndpointInfo.databaseName,
        );
    };

    const handleOptionsClicked = () => {
        props.onOptionsClicked();
    };

    const handleSwitchEndpoints = () => {
        context.switchEndpoints(state.targetEndpointInfo, state.sourceEndpointInfo);
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
        return state.schemaCompareResult.differences.some((diff) => diff.included);
    };

    const disableGenerateScriptButton = (): boolean => {
        if (
            !(
                state.targetEndpointInfo &&
                Number(state.targetEndpointInfo.endpointType) ===
                    SchemaCompareEndpointType.Database
            )
        ) {
            return true;
        } else if (state.isComparisonInProgress) {
            return true;
        } else if (
            state.schemaCompareResult === undefined ||
            state.schemaCompareResult.differences.length === 0
        ) {
            return true;
        }

        if (!hasIncludedDiffs()) {
            return true;
        }

        return false;
    };

    const disableApplyButton = (): boolean => {
        if (
            state.schemaCompareResult &&
            state.schemaCompareResult.differences &&
            state.schemaCompareResult.differences.length > 0 &&
            Number(state.targetEndpointInfo.endpointType) !==
                SchemaCompareEndpointType.Dacpac
        ) {
            if (!hasIncludedDiffs()) {
                return true;
            }

            return false;
        }

        return true;
    };

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={loc.schemaCompare.compare}
                title={loc.schemaCompare.compare}
                icon={<ColumnDoubleCompareRegular />}
                onClick={handleCompare}
                disabled={
                    isEndpointEmpty(state.sourceEndpointInfo) ||
                    isEndpointEmpty(state.targetEndpointInfo) ||
                    state.isComparisonInProgress
                }>
                {loc.schemaCompare.compare}
            </ToolbarButton>
            <ToolbarButton
                area-label={loc.schemaCompare.stop}
                title={loc.schemaCompare.stop}
                icon={<StopFilled />}
                onClick={handleStop}
                disabled={!state.isComparisonInProgress}>
                {loc.schemaCompare.stop}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.generateScript}
                title={loc.schemaCompare.generateScriptToDeployChangesToTarget}
                icon={<DocumentChevronDoubleRegular />}
                onClick={handleGenerateScript}
                disabled={disableGenerateScriptButton()}>
                {loc.schemaCompare.generateScript}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.apply}
                title={loc.schemaCompare.applyChangesToTarget}
                icon={<PlayFilled />}
                onClick={handlePublishChanges}
                disabled={state.isComparisonInProgress || disableApplyButton()}>
                {loc.schemaCompare.apply}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.options}
                title={loc.schemaCompare.options}
                icon={<SettingsRegular />}
                onClick={handleOptionsClicked}
                disabled={
                    state.isComparisonInProgress ||
                    isEndpointEmpty(state.sourceEndpointInfo) ||
                    isEndpointEmpty(state.targetEndpointInfo)
                }>
                {loc.schemaCompare.options}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.switchDirection}
                title={loc.schemaCompare.switchSourceAndTarget}
                icon={<ArrowSwapFilled />}
                onClick={handleSwitchEndpoints}
                disabled={
                    state.isComparisonInProgress ||
                    (isEndpointEmpty(state.sourceEndpointInfo) &&
                        isEndpointEmpty(state.targetEndpointInfo))
                }>
                {loc.schemaCompare.switchDirection}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.openScmpFile}
                title={loc.schemaCompare.loadSourceTargetAndOptionsSavedInAnScmpFile}
                icon={<DocumentArrowUpRegular />}
                onClick={handleOpenScmp}
                disabled={state.isComparisonInProgress}>
                {loc.schemaCompare.openScmpFile}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.saveScmpFile}
                title={loc.schemaCompare.saveSourceAndTargetOptionsAndExcludedElements}
                icon={<SaveRegular />}
                onClick={handleSaveScmp}
                disabled={
                    state.isComparisonInProgress ||
                    isEndpointEmpty(state.sourceEndpointInfo) ||
                    isEndpointEmpty(state.targetEndpointInfo)
                }>
                {loc.schemaCompare.saveScmpFile}
            </ToolbarButton>
        </Toolbar>
    );
};

export default CompareActionBar;
