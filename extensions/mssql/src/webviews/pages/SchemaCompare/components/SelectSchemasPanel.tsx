/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { useContext } from "react";
import {
    Badge,
    Button,
    makeStyles,
    mergeClasses,
    shorthands,
    useId,
} from "@fluentui/react-components";
import SelectSchemaInput from "./SelectSchemaInput";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { locConstants as loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    topMargin: {
        ...shorthands.margin("32px", "32px", "0"),
    },

    marginRight: {
        marginRight: "32px",
    },

    layoutHorizontally: {
        display: "flex",
        flexDirection: "row",
    },

    layoutVertically: {
        display: "flex",
        flexDirection: "column",
    },

    center: {
        justifyContent: "center",
    },

    button: {
        height: "32px",
        position: "relative",
        top: "20px",
    },

    buttonLeftMargin: {
        marginLeft: "32px",
    },

    platformBadgeRow: {
        // Reserve a row of vertical space even when no badge is shown so that the
        // Compare button stays vertically aligned with the inputs both before and
        // after the first comparison.
        minHeight: "20px",
        marginTop: "4px",
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
    // The DacFx platforms are only populated on schemaCompareResult after a comparison runs;
    // pull them via a targeted selector so the panel does not re-render on every state change.
    const sourcePlatform = useSchemaCompareSelector((s) => s.schemaCompareResult?.sourcePlatform);
    const targetPlatform = useSchemaCompareSelector((s) => s.schemaCompareResult?.targetPlatform);

    let sourceEndpointDisplay = getEndpointDisplayName(sourceEndpointInfo);
    let targetEndpointDisplay = getEndpointDisplayName(targetEndpointInfo);

    const handleCompare = () => {
        context.compare(
            sourceEndpointInfo,
            targetEndpointInfo,
            defaultDeploymentOptionsResult.defaultDeploymentOptions,
        );
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

    const renderPlatformBadge = (platform: string | undefined, endpointLabel: string) => (
        <div className={classes.platformBadgeRow}>
            {platform ? (
                <Badge
                    appearance="outline"
                    size="small"
                    aria-label={loc.schemaCompare.platformBadgeAriaLabel(endpointLabel, platform)}>
                    {loc.schemaCompare.platformBadge(platform)}
                </Badge>
            ) : null}
        </div>
    );

    return (
        <div
            className={mergeClasses(classes.layoutHorizontally, classes.center, classes.topMargin)}>
            <div className={mergeClasses(classes.layoutVertically, classes.marginRight)}>
                <SelectSchemaInput
                    id={sourceId}
                    label={loc.schemaCompare.source}
                    buttonAriaLabel={loc.schemaCompare.selectSourceSchema}
                    value={sourceEndpointDisplay}
                    disableBrowseButton={isComparisonInProgress || isApplyInProgress}
                    selectFile={() => onSelectSchemaClicked("source")}
                />
                {renderPlatformBadge(sourcePlatform, loc.schemaCompare.source)}
            </div>

            <div className={classes.layoutVertically}>
                <SelectSchemaInput
                    id={targetId}
                    label={loc.schemaCompare.target}
                    buttonAriaLabel={loc.schemaCompare.selectTargetSchema}
                    value={targetEndpointDisplay}
                    disableBrowseButton={isComparisonInProgress || isApplyInProgress}
                    selectFile={() => onSelectSchemaClicked("target")}
                />
                {renderPlatformBadge(targetPlatform, loc.schemaCompare.target)}
            </div>

            <Button
                className={mergeClasses(classes.button, classes.buttonLeftMargin)}
                size="medium"
                onClick={handleCompare}
                disabled={
                    isEndpointEmpty(sourceEndpointInfo) ||
                    isEndpointEmpty(targetEndpointInfo) ||
                    isComparisonInProgress ||
                    isApplyInProgress
                }>
                {loc.schemaCompare.compare}
            </Button>
        </div>
    );
};

export default SelectSchemasPanel;
