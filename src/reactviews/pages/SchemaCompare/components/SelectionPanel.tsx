/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Label,
    Input,
    Button,
    makeStyles,
    mergeClasses,
    shorthands,
    useId,
    type InputProps,
} from "@fluentui/react-components";

import { ArrowSwapFilled, AddFilled } from "@fluentui/react-icons";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useContext } from "react";

const useStyles = makeStyles({
    topMargin: {
        ...shorthands.margin("32px", "32px", "0"),
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

    button: {
        height: "40px",
        position: "relative",
        top: "20px",
    },

    buttonHorizontalMargin: {
        ...shorthands.margin("0", "32px"),
    },

    buttonLeftSmallMargin: {
        marginLeft: "2px",
    },

    buttonLeftMargin: {
        marginLeft: "32px",
    },
});

interface Props extends InputProps {}

const SelectionPanel: React.FC<Props> = (props: Props) => {
    const sourceId = useId("source");
    const targetId = useId("target");
    const classes = useStyles();
    const context = useContext(schemaCompareContext);

    const handleAddSource = () => {
        context.selectSourceDrawer.setOpen(true);
    };

    return (
        <>
            <div
                className={mergeClasses(
                    classes.positionItemsHorizontally,
                    classes.center,
                    classes.topMargin,
                )}
            >
                <div
                    className={mergeClasses(
                        classes.positionItemsVertically,
                        classes.inputWidth,
                    )}
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
                        <Button
                            className={classes.buttonLeftSmallMargin}
                            size="large"
                            icon={<AddFilled />}
                            onClick={handleAddSource}
                        />
                    </div>
                </div>

                <Button
                    className={mergeClasses(
                        classes.button,
                        classes.buttonHorizontalMargin,
                    )}
                    size="large"
                    icon={<ArrowSwapFilled />}
                />

                <div
                    className={mergeClasses(
                        classes.positionItemsVertically,
                        classes.inputWidth,
                    )}
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
                        <Button
                            className={classes.buttonLeftSmallMargin}
                            size="large"
                            icon={<AddFilled />}
                        />
                    </div>
                </div>

                <Button
                    className={mergeClasses(
                        classes.button,
                        classes.buttonLeftMargin,
                    )}
                    size="large"
                >
                    Compare
                </Button>
            </div>
        </>
    );
};

export default SelectionPanel;
