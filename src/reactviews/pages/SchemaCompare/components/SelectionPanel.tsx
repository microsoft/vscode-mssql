/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Label,
    Input,
    Button,
    makeStyles,
    shorthands,
    useId,
    type InputProps,
} from "@fluentui/react-components";

import { ArrowSwapFilled, AddFilled } from "@fluentui/react-icons";

const useStyles = makeStyles({
    topMargin: {
        ...shorthands.margin("32px", "0", "0"),
    },

    positionItemsHorizontally: {
        display: "flex",
        flexDirection: "row",
    },

    center: {
        justifyContent: "center",
    },

    positionItemsVertically: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },

    inputWidth: {
        width: "100%",
        maxWidth: "745px",
        minwidth: "300px",
    },

    swapButton: {
        height: "40px",
        position: "relative",
        top: "20px",
        ...shorthands.margin("0", "32px"),
    },
});

interface Props extends InputProps {}

const SelectionPanel: React.FC<Props> = (props: Props) => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();

    return (
        <>
            <div
                className={[
                    classes.positionItemsHorizontally,
                    classes.center,
                    classes.topMargin,
                ].join(" ")}
            >
                <div
                    className={[
                        classes.positionItemsVertically,
                        classes.inputWidth,
                    ].join(" ")}
                >
                    <Label
                        htmlFor={sourceId}
                        size={props.size}
                        disabled={props.disabled}
                    >
                        Source
                    </Label>
                    <div className={classes.positionItemsHorizontally}>
                        <Input
                            id={sourceId}
                            className={classes.inputWidth}
                            {...props}
                            value="C:\DatabaseProjects\SampleProj\SampleProj.sqlproj"
                            readOnly
                        />
                        <Button size="large" icon={<AddFilled />} />
                    </div>
                </div>

                <Button
                    className={classes.swapButton}
                    size="large"
                    icon={<ArrowSwapFilled />}
                />

                <div
                    className={[
                        classes.positionItemsVertically,
                        classes.inputWidth,
                    ].join(" ")}
                >
                    <Label
                        htmlFor={targetId}
                        size={props.size}
                        disabled={props.disabled}
                    >
                        Target
                    </Label>
                    <div className={classes.positionItemsHorizontally}>
                        <Input
                            id={targetId}
                            className={classes.inputWidth}
                            {...props}
                            value="C:\DatabaseProjects\SampleProj\SampleProj.sqlproj"
                            readOnly
                        />
                        <Button size="large" icon={<AddFilled />} />
                    </div>
                </div>
            </div>
        </>
    );
};

export default SelectionPanel;
