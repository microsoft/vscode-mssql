/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
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
} from "@fluentui/react-icons";

import { locConstants as loc } from "../../../common/locConstants";
import { useContext } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";

const CompareActionBar = () => {
    const context = useContext(schemaCompareContext);

    const handleStop = () => {
        context.cancel();
    };

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={loc.schemaCompare.compare}
                title={loc.schemaCompare.compare}
                icon={<ColumnDoubleCompareRegular />}
            >
                {loc.schemaCompare.compare}
            </ToolbarButton>
            <ToolbarButton
                area-label={loc.schemaCompare.stop}
                title={loc.schemaCompare.stop}
                icon={<StopFilled />}
                onClick={handleStop}
            >
                {loc.schemaCompare.stop}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.generateScript}
                title={loc.schemaCompare.generateScriptToDeployChangesToTarget}
                icon={<DocumentChevronDoubleRegular />}
            >
                {loc.schemaCompare.generateScript}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.apply}
                title={loc.schemaCompare.applyChangesToTarget}
                icon={<PlayFilled />}
            >
                {loc.schemaCompare.apply}
            </ToolbarButton>
            <ToolbarButton
                aria-lable={loc.schemaCompare.options}
                title={loc.schemaCompare.options}
                icon={<SettingsRegular />}
            >
                {loc.schemaCompare.options}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.switchDirection}
                title={loc.schemaCompare.switchSourceAndTarget}
                icon={<ArrowSwapFilled />}
            >
                {loc.schemaCompare.switchDirection}
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
                aria-label={loc.schemaCompare.openScmpFile}
                title={
                    loc.schemaCompare
                        .loadSourceTargetAndOptionsSavedInAnScmpFile
                }
                icon={<DocumentArrowUpRegular />}
            >
                {loc.schemaCompare.openScmpFile}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.schemaCompare.saveScmpFile}
                title={
                    loc.schemaCompare
                        .saveSourceAndTargetOptionsAndExcludedElements
                }
                icon={<SaveRegular />}
            >
                {loc.schemaCompare.saveScmpFile}
            </ToolbarButton>
        </Toolbar>
    );
};

export default CompareActionBar;
