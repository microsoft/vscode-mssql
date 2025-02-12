/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Input,
    Button,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "row",
        ...shorthands.margin("32px", "32px", "0"),
    },

    input: {
        width: "100%",
        maxWidth: "745px",
        minwidth: "300px",
    },

    button: {
        ...shorthands.margin("0", "32px"),
    },
});

interface Props {}

const SelectionPanel: React.FC<Props> = () => {
    const classes = useStyles();

    return (
        <div className={classes.container}>
            <Input
                className={classes.input}
                value="C:\DatabaseProjects\SampleProj\SampleProj.sqlproj"
                readOnly
            />
            <Button className={classes.button}>Change Direction</Button>
            <Input
                className={classes.input}
                value="C:\DatabaseProjects\SampleProj2\SampleProj2.sqlproj"
                readOnly
            />
        </div>
    );
};

export default SelectionPanel;
