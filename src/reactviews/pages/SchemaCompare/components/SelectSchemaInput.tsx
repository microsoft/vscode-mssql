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
        marginLeft: "2px",
    },
});

interface Props extends InputProps {
    label: string;
    onClick: () => void;
}

const SelectSchemaInput = (props: Props) => {
    const classes = useStyles();

    return (
        <div
            className={mergeClasses(
                classes.layoutVertically,
                classes.inputWidth,
            )}
        >
            <Label
                htmlFor={props.id}
                size={props.size}
                disabled={props.disabled}
            >
                {props.label}
            </Label>
            <div className={classes.layoutHorizontally}>
                <Input
                    id={props.id}
                    className={classes.inputWidth}
                    {...props}
                    value={props.value}
                    readOnly
                />
                <Button
                    size="small"
                    className={classes.buttonLeftSmallMargin}
                    onClick={props.onClick}
                >
                    ...
                </Button>
            </div>
        </div>
    );
};

export default SelectSchemaInput;
