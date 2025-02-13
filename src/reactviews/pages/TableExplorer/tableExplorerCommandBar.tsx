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
    OptionOnSelectData,
    SelectionEvents,
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
    refreshButton: {
        border: "none",
    },
});

const options = ["10 rows", "100 rows", "1000 rows"];
const valueMap: Record<string, number> = {
    "10 rows": 10,
    "100 rows": 100,
    "1000 rows": 1000,
};

export const TableExplorerCommandBar = () => {
    const classes = useStyles();
    const context = useContext(TableExplorerContext);
    const tableExporerState = context?.state;

    if (!tableExporerState) {
        return null;
    }

    const onRowNumberOptionSelect = (
        _: SelectionEvents,
        data: OptionOnSelectData,
    ) => {
        //TODO: trigger state update using reducer
        context.setTableExplorerResults(valueMap[data.optionValue]);
    };

    //TODO: implement refresh data
    const onRefresh = () => {};

    //TODO: implement search on type
    const onSearch = () => {};

    return (
        <div className={classes.commandBar}>
            <SearchBox placeholder="Search" onKeyDown={onSearch} />
            <Button disabled={true}>View SQL Script</Button>
            <Button
                className={classes.refreshButton}
                icon={<ArrowClockwise16Filled />}
                onClick={onRefresh}
            >
                Refresh
            </Button>
            <Dropdown
                onOptionSelect={onRowNumberOptionSelect}
                className={classes.dropdown}
                //TODO: update this based on a config setting
                defaultValue={options[0]}
            >
                {options.map((option) => (
                    <Option key={option}>{option}</Option>
                ))}
            </Dropdown>
        </div>
    );
};
