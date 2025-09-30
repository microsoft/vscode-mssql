/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Dropdown, Option } from "@fluentui/react-components";
import { SaveRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { useState } from "react";

export const TableExplorerToolbar: React.FC = () => {
    const context = useTableExplorerContext();
    const [selectedValue, setSelectedValue] = useState<string>("100");

    const handleSave = () => {
        context.commitChanges();
    };

    const handleDropdownChange = (_event: any, data: any) => {
        const newValue = data.optionValue;
        setSelectedValue(newValue);
        // Call the loadSubset reducer with the new row count
        context.loadSubset(parseInt(newValue, 10));
    };

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={loc.tableExplorer.save}
                title={loc.tableExplorer.save}
                icon={<SaveRegular />}
                onClick={handleSave}>
                {loc.tableExplorer.save}
            </ToolbarButton>
            <Dropdown
                value={selectedValue}
                selectedOptions={[selectedValue]}
                onOptionSelect={handleDropdownChange}
                style={{ minWidth: "100px" }}>
                <Option value="10">10</Option>
                <Option value="100">100</Option>
                <Option value="1000">1000</Option>
            </Dropdown>
        </Toolbar>
    );
};
