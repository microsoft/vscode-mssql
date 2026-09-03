/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { useContext } from "react";
import { Button, makeStyles, Tooltip, useId } from "@fluentui/react-components";
import { ArrowSwap16Regular } from "@fluentui/react-icons";
import SelectSchemaInput from "./SelectSchemaInput";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { locConstants as loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "10px 14px",
        padding: "12px 14px",
    },
    switchButton: {
        flex: "0 0 24px",
        minWidth: "24px",
        width: "24px",
        height: "28px",
    },
    compareButton: {
        flex: "0 0 112px",
        minWidth: "112px",
        width: "112px",
        height: "28px",
        paddingLeft: "16px",
        paddingRight: "16px",
    },
});

function getEndpointDisplayName(endpoint: mssql.SchemaCompareEndpointInfo): string {
    let displayName =
        (endpoint?.serverName && endpoint?.databaseName
            ? `${endpoint?.connectionName || endpoint?.serverName}.${endpoint?.databaseName}`
            : "") ||
        endpoint?.packageFilePath ||
        endpoint?.projectFilePath ||
        "";

    return displayName;
}

interface Props {
    onSelectSchemaClicked: (endpointType: "source" | "target") => void;
}

const SelectSchemasPanel = ({ onSelectSchemaClicked }: Props) => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
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

    let sourceEndpointDisplay = getEndpointDisplayName(sourceEndpointInfo);
    let targetEndpointDisplay = getEndpointDisplayName(targetEndpointInfo);

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

    const handleSwitchEndpoints = () => {
        context.switchEndpoints(targetEndpointInfo, sourceEndpointInfo);
    };

    const isEndpointEmpty = (endpoint: mssql.SchemaCompareEndpointInfo): boolean => {
        if (
            endpoint &&
            (endpoint.serverDisplayName || endpoint.packageFilePath || endpoint.projectFilePath)
        ) {
            return false;
        }
        return true;
    };

    return (
        <div className={classes.root}>
            <SelectSchemaInput
                id={sourceId}
                label={loc.schemaCompare.source}
                buttonAriaLabel={loc.schemaCompare.selectSourceSchema}
                value={sourceEndpointDisplay}
                endpointType={sourceEndpointInfo?.endpointType}
                disableBrowseButton={
                    isComparisonInProgress || isApplyInProgress || isEndpointSelectionInProgress
                }
                selectFile={() => onSelectSchemaClicked("source")}
            />

            <Tooltip content={loc.schemaCompare.switchSourceAndTarget} relationship="label">
                <Button
                    className={classes.switchButton}
                    size="small"
                    appearance="subtle"
                    icon={<ArrowSwap16Regular />}
                    onClick={handleSwitchEndpoints}
                    disabled={
                        isComparisonInProgress ||
                        isApplyInProgress ||
                        isEndpointSelectionInProgress ||
                        (isEndpointEmpty(sourceEndpointInfo) && isEndpointEmpty(targetEndpointInfo))
                    }
                />
            </Tooltip>

            <SelectSchemaInput
                id={targetId}
                label={loc.schemaCompare.target}
                buttonAriaLabel={loc.schemaCompare.selectTargetSchema}
                value={targetEndpointDisplay}
                endpointType={targetEndpointInfo?.endpointType}
                disableBrowseButton={
                    isComparisonInProgress || isApplyInProgress || isEndpointSelectionInProgress
                }
                selectFile={() => onSelectSchemaClicked("target")}
            />

            <Button
                className={classes.compareButton}
                appearance="primary"
                size="small"
                onClick={handleCompare}
                disabled={
                    isEndpointEmpty(sourceEndpointInfo) ||
                    isEndpointEmpty(targetEndpointInfo) ||
                    isComparisonInProgress ||
                    isApplyInProgress ||
                    isEndpointSelectionInProgress
                }>
                {loc.schemaCompare.compare}
            </Button>
        </div>
    );
};

export default SelectSchemasPanel;
