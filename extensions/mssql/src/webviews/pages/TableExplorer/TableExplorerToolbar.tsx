/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    Toolbar,
    ToolbarButton,
    Combobox,
    Option,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    Checkbox,
} from "@fluentui/react-components";
import {
    SaveRegular,
    AddRegular,
    CodeRegular,
    OrganizationRegular,
    ArrowDownloadRegular,
    ColumnRegular,
    DeleteRegular,
    DocumentTextRegular,
} from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import type { DataColumnVisibility } from "./TableDataGrid";

interface TableExplorerToolbarProps {
    onSaveComplete?: () => void;
    cellChangeCount: number;
    deletionCount: number;
    currentRowCount?: number;
    onLoadSubset?: (rowCount: number) => void;
    onExport?: (format: "csv" | "excel" | "json") => void;
    getDataColumns?: () => DataColumnVisibility[];
    onSetColumnVisibility?: (id: string, visible: boolean) => void;
    onShowSql?: () => void;
    selectedRowCount?: number;
    onDeleteSelected?: () => void;
}

interface ColumnsMenuProps {
    isLoading: boolean;
    getDataColumns: () => DataColumnVisibility[];
    onSetColumnVisibility: (id: string, visible: boolean) => void;
}

const ColumnsMenu: React.FC<ColumnsMenuProps> = ({
    isLoading,
    getDataColumns,
    onSetColumnVisibility,
}) => {
    const [open, setOpen] = React.useState(false);
    const [cols, setCols] = React.useState<DataColumnVisibility[]>([]);

    const refresh = React.useCallback(() => {
        setCols(getDataColumns());
    }, [getDataColumns]);

    React.useEffect(() => {
        if (open) {
            refresh();
        }
    }, [open, refresh]);

    return (
        <Menu open={open} onOpenChange={(_, data) => setOpen(data.open)}>
            <MenuTrigger disableButtonEnhancement>
                <ToolbarButton
                    aria-label={loc.tableExplorer.columns}
                    title={loc.tableExplorer.columns}
                    icon={<ColumnRegular />}
                    disabled={isLoading}>
                    {loc.tableExplorer.columns}
                </ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {cols.map((col) => (
                        <MenuItem
                            key={col.id}
                            persistOnClick
                            onClick={() => {
                                onSetColumnVisibility(col.id, !col.visible);
                                refresh();
                            }}>
                            <Checkbox
                                checked={col.visible}
                                label={col.name}
                                // Visual only — the parent MenuItem owns the click handler.
                                // Without onChange, Fluent treats the checkbox as controlled-readonly
                                // and won't fire its own toggle on click.
                                onChange={() => undefined}
                            />
                        </MenuItem>
                    ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

export const TableExplorerToolbar: React.FC<TableExplorerToolbarProps> = ({
    onSaveComplete,
    cellChangeCount,
    deletionCount,
    currentRowCount,
    onLoadSubset,
    onExport,
    getDataColumns,
    onSetColumnVisibility,
    onShowSql,
    selectedRowCount = 0,
    onDeleteSelected,
}) => {
    const context = useTableExplorerContext();
    const DEFAULT_ROW_COUNT = 100;
    const MIN_VALID_NUMBER = 1;
    const RADIX_DECIMAL = 10;

    // Use selectors to access state
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const isLoading = loadStatus === ApiStatus.Loading;

    const [loadRowCount, setLoadRowCount] = React.useState<string>(String(DEFAULT_ROW_COUNT));

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

    const fetchRowsForValue = (rawValue: string) => {
        const rowCountNumber = parseInt(rawValue || String(DEFAULT_ROW_COUNT), RADIX_DECIMAL);
        if (!isNaN(rowCountNumber) && rowCountNumber >= MIN_VALID_NUMBER && onLoadSubset) {
            onLoadSubset(rowCountNumber);
        }
    };

    const onRowCountChange = (event: any) => {
        const newValue = event.target.value;
        setLoadRowCount(newValue);
    };

    const onRowCountSelect = (_event: any, data: any) => {
        if (data.optionValue) {
            setLoadRowCount(data.optionValue);
            fetchRowsForValue(data.optionValue);
        }
    };

    const onRowCountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            fetchRowsForValue((event.target as HTMLInputElement).value);
        }
    };

    // Update loadRowCount when currentRowCount prop changes
    React.useEffect(() => {
        if (currentRowCount !== undefined) {
            setLoadRowCount(String(currentRowCount));
        }
    }, [currentRowCount]);

    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);

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
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <SplitButton
                        icon={<CodeRegular />}
                        disabled={isLoading}
                        size="small"
                        primaryActionButton={{
                            onClick: showScriptPane ? () => context.toggleScriptPane() : undefined,
                        }}
                        menuButton={{
                            "aria-label": showScriptPane
                                ? loc.tableExplorer.hideSqlPane
                                : loc.tableExplorer.showSqlPane,
                        }}>
                        {showScriptPane
                            ? loc.tableExplorer.hideSqlPane
                            : loc.tableExplorer.showSqlPane}
                    </SplitButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={() => context.generateScript()}>
                            {loc.tableExplorer.scriptChanges}
                        </MenuItem>
                        <MenuItem onClick={() => context.showTableQuery()}>
                            {loc.tableExplorer.tableQuery}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
            <ToolbarButton
                aria-label={loc.tableExplorer.viewTableDiagram}
                title={loc.tableExplorer.viewTableDiagram}
                icon={<OrganizationRegular />}
                onClick={() => context.viewTableDiagram()}
                disabled={isLoading}>
                {loc.tableExplorer.viewTableDiagram}
            </ToolbarButton>
            {onShowSql && (
                <ToolbarButton
                    aria-label={loc.tableExplorer.showSql}
                    title={loc.tableExplorer.openSqlInEditor}
                    icon={<DocumentTextRegular />}
                    onClick={onShowSql}
                    disabled={isLoading}>
                    {loc.tableExplorer.showSql}
                </ToolbarButton>
            )}
            {onExport && (
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <ToolbarButton
                            aria-label={loc.tableExplorer.export}
                            title={loc.tableExplorer.export}
                            icon={<ArrowDownloadRegular />}
                            disabled={isLoading}>
                            {loc.tableExplorer.export}
                        </ToolbarButton>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem onClick={() => onExport("csv")}>
                                {loc.slickGrid.exportToCsv}
                            </MenuItem>
                            <MenuItem onClick={() => onExport("excel")}>
                                {loc.slickGrid.exportToExcel}
                            </MenuItem>
                            <MenuItem onClick={() => onExport("json")}>
                                {loc.slickGrid.exportToJson}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            )}
            {getDataColumns && onSetColumnVisibility && (
                <ColumnsMenu
                    isLoading={isLoading}
                    getDataColumns={getDataColumns}
                    onSetColumnVisibility={onSetColumnVisibility}
                />
            )}
            {selectedRowCount > 0 && onDeleteSelected && (
                <ToolbarButton
                    aria-label={loc.tableExplorer.deleteSelected(selectedRowCount)}
                    title={loc.tableExplorer.deleteSelected(selectedRowCount)}
                    icon={<DeleteRegular />}
                    onClick={onDeleteSelected}
                    disabled={isLoading}>
                    {loc.tableExplorer.deleteSelected(selectedRowCount)}
                </ToolbarButton>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                <span style={{ fontSize: "12px" }}>{loc.tableExplorer.totalRowsToFetch}</span>
                <Combobox
                    value={loadRowCount}
                    onChange={onRowCountChange}
                    onOptionSelect={onRowCountSelect}
                    onKeyDown={onRowCountKeyDown}
                    size="small"
                    freeform
                    disabled={isLoading}>
                    <Option value="10">10</Option>
                    <Option value="50">50</Option>
                    <Option value="100">100</Option>
                    <Option value="500">500</Option>
                    <Option value="1000">1000</Option>
                </Combobox>
            </div>
        </Toolbar>
    );
};
