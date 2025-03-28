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

    const disableApplyButton = (): boolean => {
        if (
            context.state.schemaCompareResult &&
            context.state.schemaCompareResult.differences &&
            context.state.schemaCompareResult.differences.length > 0 &&
            Number(context.state.targetEndpointInfo.endpointType) !== 1 // Dacpac lewissanchez todo: Figure out how to move away from these magic numbers for enums
        ) {
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
                disabled={
                    context.state.targetEndpointInfo &&
                    Number(context.state.targetEndpointInfo.endpointType) === 0 // Database lewissanchez todo: Get rid of this magic number too by figuring out how to ref it from vscode-mssql
                        ? false
                        : true
                }>
                {loc.schemaCompare.generateScript}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.apply}
                title={loc.schemaCompare.applyChangesToTarget}
                icon={<PlayFilled />}
                onClick={handlePublishChanges}
                disabled={disableApplyButton()}>
                {loc.schemaCompare.apply}
            </ToolbarButton>
            <ToolbarButton
                aria-lable={loc.schemaCompare.options}
                title={loc.schemaCompare.options}
                icon={<SettingsRegular />}
                onClick={handleOptionsClicked}
                disabled={
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
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo)
                }>
                {loc.schemaCompare.switchDirection}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.openScmpFile}
                title={loc.schemaCompare.loadSourceTargetAndOptionsSavedInAnScmpFile}
                icon={<DocumentArrowUpRegular />}
                onClick={handleOpenScmp}>
                {loc.schemaCompare.openScmpFile}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.saveScmpFile}
                title={loc.schemaCompare.saveSourceAndTargetOptionsAndExcludedElements}
                icon={<SaveRegular />}
                onClick={handleSaveScmp}
                disabled={
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo)
                }>
                {loc.schemaCompare.saveScmpFile}
            </ToolbarButton>
        </Toolbar>
    );
};

export default CompareActionBar;
