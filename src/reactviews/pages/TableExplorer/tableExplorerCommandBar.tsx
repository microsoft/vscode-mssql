/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { TableExplorerContext } from "./tableExplorerStateProvider";
import {
    SearchBox,
    Button,
    Dropdown,
    Option,
    makeStyles,
} from "@fluentui/react-components";
import { ArrowClockwise16Filled } from "@fluentui/react-icons";

const useStyles = makeStyles({
    commandBar: {
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        marginTop: "10px",
    },
    dropdown: {
        marginLeft: "auto",
    },
});

export const TableExplorerCommandBar = () => {
    const classes = useStyles();
    const context = useContext(TableExplorerContext);
    const tableExporerState = context?.state;

    if (!tableExporerState) {
        return null;
    }

    const onRowNumberOptionSelect = () => {
        //TODO: implement row number selection change event
    };

    const options = ["10 rows", "100 rows", "1000 rows"];

    return (
        <div className={classes.commandBar}>
            <SearchBox placeholder="Search" />
            <Button icon={<ArrowClockwise16Filled />}></Button>
            <Dropdown
                value={"10 rows"}
                onOptionSelect={onRowNumberOptionSelect}
                className={classes.dropdown}
            >
                {options.map((option) => (
                    <Option key={option}>{option}</Option>
                ))}
            </Dropdown>
        </div>
    );
};
