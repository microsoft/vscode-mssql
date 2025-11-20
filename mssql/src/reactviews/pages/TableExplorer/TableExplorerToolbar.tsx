/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { Toolbar, ToolbarButton, Combobox, Option, Button } from "@fluentui/react-components";
import { SaveRegular, AddRegular, CodeRegular, ArrowSyncRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { ApiStatus } from "../../../sharedInterfaces/webview";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
    pendingChangesCount: number;
    currentRowCount?: number;
    onLoadSubset?: (rowCount: number) => void;
}

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({
    onSaveComplete,
    pendingChangesCount,
    currentRowCount,
    onLoadSubset,
}) => {
    const context = useTableExplorerContext();
    const DEFAULT_ROW_COUNT = 100;
    const MIN_VALID_NUMBER = 1;
    const RADIX_DECIMAL = 10;

    // Use selectors to access state
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const isLoading = loadStatus === ApiStatus.Loading;

    const [selectedRowCount, setSelectedRowCount] = React.useState<string>(
        String(DEFAULT_ROW_COUNT),
    );

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

    const onRowCountChange = (event: any) => {
        const newValue = event.target.value;
        setSelectedRowCount(newValue);
    };

    const onRowCountSelect = (_event: any, data: any) => {
        if (data.optionValue) {
            setSelectedRowCount(data.optionValue);
        }
    };

    const onFetchRowsClick = () => {
        const rowCountNumber = parseInt(
            selectedRowCount || String(DEFAULT_ROW_COUNT),
            RADIX_DECIMAL,
        );

        if (!isNaN(rowCountNumber) && rowCountNumber >= MIN_VALID_NUMBER && onLoadSubset) {
            onLoadSubset(rowCountNumber);
        }
    };

    // Update selectedRowCount when currentRowCount prop changes
    React.useEffect(() => {
        if (currentRowCount !== undefined) {
            setSelectedRowCount(String(currentRowCount));
        }
    }, [currentRowCount]);

    const saveButtonText =
        pendingChangesCount > 0
            ? `${loc.tableExplorer.saveChanges} (${pendingChangesCount})`
            : loc.tableExplorer.saveChanges;

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={saveButtonText}
                title={saveButtonText}
                icon={<SaveRegular />}
                onClick={handleSave}
                disabled={pendingChangesCount === 0 || isLoading}>
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                <span style={{ fontSize: "12px" }}>{loc.tableExplorer.totalRowsToFetch}</span>
                <Combobox
                    value={selectedRowCount}
                    onChange={onRowCountChange}
                    onOptionSelect={onRowCountSelect}
                    size="small"
                    freeform
                    disabled={isLoading}>
                    <Option value="10">10</Option>
                    <Option value="50">50</Option>
                    <Option value="100">100</Option>
                    <Option value="500">500</Option>
                    <Option value="1000">1000</Option>
                </Combobox>
                <Button
                    appearance="primary"
                    size="small"
                    icon={<ArrowSyncRegular />}
                    onClick={onFetchRowsClick}
                    title={loc.tableExplorer.fetchRows}
                    aria-label={loc.tableExplorer.fetchRows}
                    disabled={isLoading}
                />
            </div>
        </Toolbar>
    );
};
