/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Input,
    Button,
    makeStyles,
    shorthands,
    type InputProps,
} from "@fluentui/react-components";

import { ArrowSwapFilled, AddFilled } from "@fluentui/react-icons";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "row",
        ...shorthands.margin("32px", "32px", "0"),
    },

    inputWidth: {
        width: "100%",
        maxWidth: "745px",
        minwidth: "300px",
    },

    horizonalMargin: {
        ...shorthands.margin("0", "32px"),
    },
});

const SelectionPanel: React.FC<InputProps> = (props: InputProps) => {
    const classes = useStyles();

    return (
        <div className={classes.container}>
            <Input
                className={classes.inputWidth}
                {...props}
                value="C:\DatabaseProjects\SampleProj\SampleProj.sqlproj"
                readOnly
            />

            <Button size="large" icon={<AddFilled />} />
            <Button
                className={classes.horizonalMargin}
                size="large"
                icon={<ArrowSwapFilled />}
            />

            <Input
                className={classes.inputWidth}
                {...props}
                value="C:\DatabaseProjects\SampleProj2\SampleProj2.sqlproj"
                readOnly
            />

            <Button size="large" icon={<AddFilled />} />
        </div>
    );
};

export default SelectionPanel;
