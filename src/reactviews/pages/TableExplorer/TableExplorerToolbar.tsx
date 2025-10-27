/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-components";
import { SaveRegular, AddRegular, CodeRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
}

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({ onSaveComplete }) => {
    const context = useTableExplorerContext();

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
        </Toolbar>
    );
};
