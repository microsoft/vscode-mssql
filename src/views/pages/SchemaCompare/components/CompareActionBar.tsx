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
import { SchemaCompareEndpointType } from "../../../../shared/schemaCompare";

interface Props {
    onOptionsClicked: () => void;
}

const CompareActionBar = (props: Props) => {
    const context = useContext(schemaCompareContext);

    useEffect(() => {
        if (
            context.state.endpointsSwitched &&
            context.state.sourceEndpointInfo &&
            context.state.targetEndpointInfo
        ) {
            handleCompare();
        }
    }, [context.state.endpointsSwitched]);

    const handleCompare = () => {
        context.compare(
            context.state.sourceEndpointInfo,
            context.state.targetEndpointInfo,
            context.state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
        );
    };

    const handleStop = () => {
        context.cancel();
    };

    const handleGenerateScript = () => {
        context.generateScript(
            context.state.targetEndpointInfo.serverName,
            context.state.targetEndpointInfo.databaseName,
        );
    };

    const handlePublishChanges = () => {
        context.publishChanges(
            context.state.targetEndpointInfo.serverName,
            context.state.targetEndpointInfo.databaseName,
        );
    };

    const handleOptionsClicked = () => {
        props.onOptionsClicked();
    };

    const handleSwitchEndpoints = () => {
        context.switchEndpoints(context.state.targetEndpointInfo, context.state.sourceEndpointInfo);
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
        return context.state.schemaCompareResult.differences.some((diff) => diff.included);
    };

    const disableGenerateScriptButton = (): boolean => {
        if (
            !(
                context.state.targetEndpointInfo &&
                Number(context.state.targetEndpointInfo.endpointType) ===
                    SchemaCompareEndpointType.Database
            )
        ) {
            return true;
        } else if (context.state.isComparisonInProgress) {
            return true;
        } else if (
            context.state.schemaCompareResult === undefined ||
            context.state.schemaCompareResult.differences.length === 0
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
            context.state.schemaCompareResult &&
            context.state.schemaCompareResult.differences &&
            context.state.schemaCompareResult.differences.length > 0 &&
            Number(context.state.targetEndpointInfo.endpointType) !==
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
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo) ||
                    context.state.isComparisonInProgress
                }>
                {loc.schemaCompare.compare}
            </ToolbarButton>
            <ToolbarButton
                area-label={loc.schemaCompare.stop}
                title={loc.schemaCompare.stop}
                icon={<StopFilled />}
                onClick={handleStop}
                disabled={!context.state.isComparisonInProgress}>
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
                disabled={context.state.isComparisonInProgress || disableApplyButton()}>
                {loc.schemaCompare.apply}
            </ToolbarButton>
            <ToolbarButton
                aria-lable={loc.schemaCompare.options}
                title={loc.schemaCompare.options}
                icon={<SettingsRegular />}
                onClick={handleOptionsClicked}
                disabled={
                    context.state.isComparisonInProgress ||
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo)
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
                    context.state.isComparisonInProgress ||
                    (isEndpointEmpty(context.state.sourceEndpointInfo) &&
                        isEndpointEmpty(context.state.targetEndpointInfo))
                }>
                {loc.schemaCompare.switchDirection}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.openScmpFile}
                title={loc.schemaCompare.loadSourceTargetAndOptionsSavedInAnScmpFile}
                icon={<DocumentArrowUpRegular />}
                onClick={handleOpenScmp}
                disabled={context.state.isComparisonInProgress}>
                {loc.schemaCompare.openScmpFile}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.saveScmpFile}
                title={loc.schemaCompare.saveSourceAndTargetOptionsAndExcludedElements}
                icon={<SaveRegular />}
                onClick={handleSaveScmp}
                disabled={
                    context.state.isComparisonInProgress ||
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo)
                }>
                {loc.schemaCompare.saveScmpFile}
            </ToolbarButton>
        </Toolbar>
    );
};

export default CompareActionBar;
