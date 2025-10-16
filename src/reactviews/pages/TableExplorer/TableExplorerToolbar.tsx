/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Combobox, Option } from "@fluentui/react-components";
import { SaveRegular, AddRegular, CodeRegular } from "@fluentui/react-icons";
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

    const handleComboboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        // Handle when user types or selects an option
        const newValue = event.target.value;
        setSelectedValue(newValue);
    };

    const handleComboboxSelect = (_event: any, data: any) => {
        // Handle when user selects from dropdown
        const newValue = data.optionValue || data.value;
        setSelectedValue(newValue);
        const newRowCount = parseInt(newValue, 10);
        if (!isNaN(newRowCount) && newRowCount > 0) {
            context.loadSubset(newRowCount);
        }
    };

    const handleComboboxBlur = () => {
        // Handle when user finishes typing (loses focus)
        const newRowCount = parseInt(selectedValue, 10);
        if (!isNaN(newRowCount) && newRowCount > 0) {
            context.loadSubset(newRowCount);
        }
    };

    const handleComboboxKeyDown = (event: React.KeyboardEvent) => {
        // Handle when user presses Enter
        if (event.key === "Enter") {
            const newRowCount = parseInt(selectedValue, 10);
            if (!isNaN(newRowCount) && newRowCount > 0) {
                context.loadSubset(newRowCount);
            }
        }
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
            <ToolbarButton
                aria-label={
                    context.state.showScriptPane
                        ? loc.tableExplorer.hideScript
                        : loc.tableExplorer.showScript
                }
                title={
                    context.state.showScriptPane
                        ? loc.tableExplorer.hideScript
                        : loc.tableExplorer.showScript
                }
                icon={<CodeRegular />}
                onClick={() => {
                    if (context.state.showScriptPane) {
                        context.toggleScriptPane();
                    } else {
                        context.generateScript();
                    }
                }}>
                {context.state.showScriptPane
                    ? loc.tableExplorer.hideScript
                    : loc.tableExplorer.showScript}
            </ToolbarButton>
            <Combobox
                value={selectedValue}
                freeform
                onChange={handleComboboxChange}
                onOptionSelect={handleComboboxSelect}
                onBlur={handleComboboxBlur}
                onKeyDown={handleComboboxKeyDown}
                placeholder="Enter row count"
                style={{ minWidth: "100px" }}>
                <Option value="10">10</Option>
                <Option value="100">100</Option>
                <Option value="1000">1000</Option>
            </Combobox>
        </Toolbar>
    );
};
