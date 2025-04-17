/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Input,
    Label,
    makeStyles,
    mergeClasses,
    type InputProps,
} from "@fluentui/react-components";

const useStyles = makeStyles({
    layoutVertically: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },

    layoutHorizontally: {
        display: "flex",
        flexDirection: "row",
    },

    inputWidth: {
        width: "100%",
        maxWidth: "745px",
        minwidth: "300px",
    },

    buttonLeftSmallMargin: {
        marginLeft: "8px",
    },
});

interface Props extends InputProps {
    label: string;
    disableBrowseButton: boolean;
    selectFile: () => void;
}

const SelectSchemaInput = (props: Props) => {
    const classes = useStyles();

    return (
        <div className={mergeClasses(classes.layoutVertically, classes.inputWidth)}>
            <Label htmlFor={props.id} size={props.size} disabled={props.disabled}>
                {props.label}
            </Label>
            <div className={mergeClasses(classes.layoutHorizontally, props.className ?? "")}>
                <Input id={props.id} className={classes.inputWidth} value={props.value} readOnly />
                <Button
                    size="small"
                    className={classes.buttonLeftSmallMargin}
                    disabled={props.disableBrowseButton}
                    onClick={props.selectFile}>
                    ...
                </Button>
            </div>
        </div>
    );
};

export default SelectSchemaInput;
