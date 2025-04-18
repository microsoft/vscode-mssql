/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { useContext } from "react";
import { Button, makeStyles, mergeClasses, shorthands, useId } from "@fluentui/react-components";
import SelectSchemaInput from "./SelectSchemaInput";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
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
});

interface Props {
    onSelectSchemaClicked: (endpointType: "source" | "target") => void;
}

const SelectSchemasPanel = ({ onSelectSchemaClicked }: Props) => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();
    const context = useContext(schemaCompareContext);

    const sourceEndpointInfo = context.state.sourceEndpointInfo;
    let sourceEndpointDisplay =
        (sourceEndpointInfo?.serverName && sourceEndpointInfo?.databaseName
            ? `${sourceEndpointInfo?.serverName}.${sourceEndpointInfo?.databaseName}`
            : "") ||
        sourceEndpointInfo?.packageFilePath ||
        sourceEndpointInfo?.projectFilePath ||
        "";

    const targetEndpointInfo = context.state.targetEndpointInfo;
    let targetEndpointDisplay =
        (targetEndpointInfo?.serverName && targetEndpointInfo?.databaseName
            ? `${targetEndpointInfo?.serverName}.${targetEndpointInfo?.databaseName}`
            : "") ||
        targetEndpointInfo?.packageFilePath ||
        targetEndpointInfo?.projectFilePath ||
        "";

    const handleCompare = () => {
        context.compare(
            context.state.sourceEndpointInfo,
            context.state.targetEndpointInfo,
            context.state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
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

    return (
        <div
            className={mergeClasses(classes.layoutHorizontally, classes.center, classes.topMargin)}>
            <SelectSchemaInput
                id={sourceId}
                label={loc.schemaCompare.source}
                value={sourceEndpointDisplay}
                disableBrowseButton={context.state.isComparisonInProgress}
                selectFile={() => onSelectSchemaClicked("source")}
                className={classes.marginRight}
            />

            <SelectSchemaInput
                id={targetId}
                label={loc.schemaCompare.target}
                value={targetEndpointDisplay}
                disableBrowseButton={context.state.isComparisonInProgress}
                selectFile={() => onSelectSchemaClicked("target")}
            />

            <Button
                className={mergeClasses(classes.button, classes.buttonLeftMargin)}
                size="medium"
                onClick={handleCompare}
                disabled={
                    isEndpointEmpty(context.state.sourceEndpointInfo) ||
                    isEndpointEmpty(context.state.targetEndpointInfo) ||
                    context.state.isComparisonInProgress
                }>
                {loc.schemaCompare.compare}
            </Button>
        </div>
    );
};

export default SelectSchemasPanel;
