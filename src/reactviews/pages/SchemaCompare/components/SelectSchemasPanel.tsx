/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    mergeClasses,
    shorthands,
    useId,
} from "@fluentui/react-components";
import SelectSchemaInput from "./SelectSchemaInput";

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

const SelectSchemasPanel = () => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();

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
                label="Source"
                value=""
                onClick={() => {}}
            />

            <SelectSchemaInput
                id={targetId}
                label="Target"
                value=""
                onClick={() => {}}
            />

            <Button
                className={mergeClasses(
                    classes.button,
                    classes.buttonLeftMargin,
                )}
                size="medium"
            >
                Compare
            </Button>
        </div>
    );
};

export default SelectSchemasPanel;
