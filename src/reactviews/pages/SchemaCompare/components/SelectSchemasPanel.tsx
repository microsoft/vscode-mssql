/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Button,
    makeStyles,
    mergeClasses,
    shorthands,
    useId,
} from "@fluentui/react-components";
import SelectSchemaInput from "./SelectSchemaInput";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    topMargin: {
        ...shorthands.margin("32px", "32px", "0"),
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

    /*
    buttonHorizontalMargin: {
        ...shorthands.margin("0", "32px"),
    },
	*/
});

interface Props {
    onSelectSchemaClicked: (endpointType: "source" | "target") => void;
}

const SelectSchemasPanel = ({ onSelectSchemaClicked }: Props) => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();
    const context = useContext(schemaCompareContext);

    // const handleSelectFile = (endpointType: "source" | "target") => {
    //     const endpoint =
    //         endpointType === "source"
    //             ? context.state.sourceEndpointInfo
    //             : context.state.targetEndpointInfo;
    //     context.selectFile(endpoint, endpointType, "sqlproj");
    // };

    const handleCompare = () => {
        context.compare(
            context.state.sourceEndpointInfo,
            context.state.targetEndpointInfo,
            context.state.defaultDeploymentOptionsResult
                .defaultDeploymentOptions,
        );
    };

    return (
        <div
            className={mergeClasses(
                classes.layoutHorizontally,
                classes.center,
                classes.topMargin,
            )}
        >
            <SelectSchemaInput
                id={sourceId}
                label={loc.schemaCompare.source}
                value={context.state.sourceEndpointInfo?.projectFilePath || ""}
                selectFile={() => onSelectSchemaClicked("source")}
            />

            <SelectSchemaInput
                id={targetId}
                label={loc.schemaCompare.target}
                value={context.state.targetEndpointInfo?.projectFilePath || ""}
                selectFile={() => onSelectSchemaClicked("target")}
            />

            <Button
                className={mergeClasses(
                    classes.button,
                    classes.buttonLeftMargin,
                )}
                size="medium"
                onClick={handleCompare}
            >
                {loc.schemaCompare.compare}
            </Button>
        </div>
    );
};

export default SelectSchemasPanel;
