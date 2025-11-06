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
import { ApiStatus } from "../../../sharedInterfaces/webview";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
    cellChangeCount: number;
    deletionCount: number;
}

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({
    onSaveComplete,
    cellChangeCount,
    deletionCount,
}) => {
    const context = useTableExplorerContext();

    // Use selectors to access state
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const isLoading = loadStatus === ApiStatus.Loading;

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

    // Total changes includes both cell edits and row deletions
    const changeCount = cellChangeCount + deletionCount;

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
                disabled={changeCount === 0 || isLoading}>
                {saveButtonText}
            </ToolbarButton>
            <ToolbarButton
                aria-label={loc.tableExplorer.addRow}
                title={loc.tableExplorer.addRow}
                icon={<AddRegular />}
                onClick={handleAddRow}
                disabled={isLoading}>
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
                }}
                disabled={isLoading}>
                {showScriptPane ? loc.tableExplorer.hideScript : loc.tableExplorer.showScript}
            </ToolbarButton>
        </Toolbar>
    );
};
