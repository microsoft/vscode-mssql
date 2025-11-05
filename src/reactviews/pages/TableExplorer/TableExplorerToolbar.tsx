/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { Toolbar, ToolbarButton } from "@fluentui/react-components";
import { SaveRegular, AddRegular, CodeRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { useTableExplorerSelector } from "./tableExplorerSelector";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
    cellChangeCount: number;
}

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({
    onSaveComplete,
    cellChangeCount,
}) => {
    const context = useTableExplorerContext();

    // Use selectors to access state
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);

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

    // Use cell-level change count directly
    // This provides accurate granularity: each cell edit counts as one change
    const changeCount = cellChangeCount;

    const saveButtonText =
        changeCount > 0
            ? `${loc.tableExplorer.saveChanges} (${changeCount})`
            : loc.tableExplorer.saveChanges;

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={saveButtonText}
                title={saveButtonText}
                icon={<SaveRegular />}
                onClick={handleSave}
                disabled={changeCount === 0}>
                {saveButtonText}
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
                    showScriptPane ? loc.tableExplorer.hideScript : loc.tableExplorer.showScript
                }
                title={showScriptPane ? loc.tableExplorer.hideScript : loc.tableExplorer.showScript}
                icon={<CodeRegular />}
                onClick={() => {
                    if (showScriptPane) {
                        context.toggleScriptPane();
                    } else {
                        context.generateScript();
                    }
                }}>
                {showScriptPane ? loc.tableExplorer.hideScript : loc.tableExplorer.showScript}
            </ToolbarButton>
        </Toolbar>
    );
};
