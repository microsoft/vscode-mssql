/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import {
    Menu,
    MenuDivider,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
} from "@fluentui/react-components";

import {
    ArrowSwapFilled,
    ColumnDoubleCompareRegular,
    DocumentArrowUpRegular,
    DocumentChevronDoubleRegular,
    PlayFilled,
    SaveRegular,
    SettingsRegular,
    StopFilled,
    TextBulletListTreeRegular,
} from "@fluentui/react-icons";

import { locConstants as loc } from "../../../common/locConstants";
import { useContext, useEffect } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { SchemaCompareEndpointType } from "../../../../sharedInterfaces/schemaCompare";
import { SchemaCompareGroupBy } from "../SchemaCompare";

interface Props {
    onOptionsClicked: () => void;
    groupBy: SchemaCompareGroupBy;
    onGroupByChange: (value: SchemaCompareGroupBy) => void;
}

const GROUP_BY_MENU_NAME = "schemaCompareGroupBy";

const CompareActionBar = (props: Props) => {
    const context = useContext(schemaCompareContext);
    const endpointsSwitched = useSchemaCompareSelector((s) => s.endpointsSwitched);
    const sourceEndpointInfo = useSchemaCompareSelector((s) => s.sourceEndpointInfo);
    const targetEndpointInfo = useSchemaCompareSelector((s) => s.targetEndpointInfo);
    const defaultDeploymentOptionsResult = useSchemaCompareSelector(
        (s) => s.defaultDeploymentOptionsResult,
    );
    const isComparisonInProgress = useSchemaCompareSelector((s) => s.isComparisonInProgress);
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);

    useEffect(() => {
        if (endpointsSwitched) {
            if (sourceEndpointInfo && targetEndpointInfo) {
                handleCompare();
            } else {
                // Reset the flag when comparison doesn't run so subsequent switches trigger the effect
                context.resetEndpointsSwitched();
            }
        }
    }, [endpointsSwitched]);

    const handleCompare = () => {
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
        return schemaCompareResult.differences.some((diff) => diff.included);
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
        } else if (
            schemaCompareResult === undefined ||
            schemaCompareResult.differences.length === 0
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
            schemaCompareResult &&
            schemaCompareResult.differences &&
            schemaCompareResult.differences.length > 0 &&
            Number(targetEndpointInfo.endpointType) !== SchemaCompareEndpointType.Dacpac
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
                    isEndpointEmpty(sourceEndpointInfo) ||
                    isEndpointEmpty(targetEndpointInfo) ||
                    isComparisonInProgress
                }>
                {loc.schemaCompare.compare}
            </ToolbarButton>
            <ToolbarButton
                area-label={loc.schemaCompare.stop}
                title={loc.schemaCompare.stop}
                icon={<StopFilled />}
                onClick={handleStop}
                disabled={!isComparisonInProgress}>
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
                disabled={isComparisonInProgress || disableApplyButton()}>
                {loc.schemaCompare.apply}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.options}
                title={loc.schemaCompare.options}
                icon={<SettingsRegular />}
                onClick={handleOptionsClicked}
                disabled={
                    isComparisonInProgress ||
                    isEndpointEmpty(sourceEndpointInfo) ||
                    isEndpointEmpty(targetEndpointInfo)
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
                    isComparisonInProgress ||
                    (isEndpointEmpty(sourceEndpointInfo) && isEndpointEmpty(targetEndpointInfo))
                }>
                {loc.schemaCompare.switchDirection}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.openScmpFile}
                title={loc.schemaCompare.loadSourceTargetAndOptionsSavedInAnScmpFile}
                icon={<DocumentArrowUpRegular />}
                onClick={handleOpenScmp}
                disabled={isComparisonInProgress}>
                {loc.schemaCompare.openScmpFile}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.saveScmpFile}
                title={loc.schemaCompare.saveSourceAndTargetOptionsAndExcludedElements}
                icon={<SaveRegular />}
                onClick={handleSaveScmp}
                disabled={
                    isComparisonInProgress ||
                    isEndpointEmpty(sourceEndpointInfo) ||
                    isEndpointEmpty(targetEndpointInfo)
                }>
                {loc.schemaCompare.saveScmpFile}
            </ToolbarButton>
            <ToolbarDivider />
            <Menu
                checkedValues={{ [GROUP_BY_MENU_NAME]: [props.groupBy] }}
                onCheckedValueChange={(_e, data) => {
                    const next = data.checkedItems[0] as SchemaCompareGroupBy | undefined;
                    if (next) {
                        props.onGroupByChange(next);
                    }
                }}>
                <MenuTrigger disableButtonEnhancement>
                    <ToolbarButton
                        aria-label={loc.schemaCompare.groupBy}
                        title={loc.schemaCompare.groupDifferencesBy}
                        icon={<TextBulletListTreeRegular />}>
                        {loc.schemaCompare.groupBy}
                    </ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItemRadio name={GROUP_BY_MENU_NAME} value="none">
                            {loc.schemaCompare.none}
                        </MenuItemRadio>
                        <MenuDivider />
                        <MenuItemRadio name={GROUP_BY_MENU_NAME} value="action">
                            {loc.schemaCompare.action}
                        </MenuItemRadio>
                        <MenuItemRadio name={GROUP_BY_MENU_NAME} value="schema">
                            {loc.schemaCompare.schema}
                        </MenuItemRadio>
                        <MenuItemRadio name={GROUP_BY_MENU_NAME} value="type">
                            {loc.schemaCompare.type}
                        </MenuItemRadio>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </Toolbar>
    );
};

export default CompareActionBar;
