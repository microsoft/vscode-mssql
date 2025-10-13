/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Dropdown, Option } from "@fluentui/react-components";
import { SaveRegular, AddRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { useState } from "react";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
}

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({ onSaveComplete }) => {
    const context = useTableExplorerContext();
    const [selectedValue, setSelectedValue] = useState<string>("100");

    const handleSave = () => {
        context.commitChanges();
        // Call the callback to clear change tracking after save
        if (onSaveComplete) {
            onSaveComplete();
        }
    };

    const handleAddRow = () => {
        context.createRow();
    };

    const handleDropdownChange = (_event: any, data: any) => {
        const newValue = data.optionValue;
        setSelectedValue(newValue);
        const newRowCount = parseInt(newValue, 10);
        // Call the loadSubset reducer with the new row count
        // This loads data from the database, but doesn't change pagination size
        context.loadSubset(newRowCount);
    };

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={loc.tableExplorer.saveChanges}
                title={loc.tableExplorer.saveChanges}
                icon={<SaveRegular />}
                onClick={handleSave}>
                {loc.tableExplorer.saveChanges}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.tableExplorer.addRow}
                title={loc.tableExplorer.addRow}
                icon={<AddRegular />}
                onClick={handleAddRow}>
                {loc.tableExplorer.addRow}
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
